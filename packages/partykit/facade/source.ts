// This is the facade for the worker that will be used in partykit.
// It will be compiled and imported by the CLI.

import type {
  PartyKitServer,
  PartyKitRoom,
  PartyKitConnection,
  PartyKitContext,
} from "../src/server";
import type {
  DurableObjectNamespace,
  DurableObjectState,
  ExecutionContext,
} from "@cloudflare/workers-types";
import fetchStaticAsset from "./fetch-static-asset";

// @ts-expect-error We'll be replacing __WORKER__
// with the path to the input worker
import Worker from "__WORKER__";
declare const Worker: PartyKitServer;

function assert(condition: unknown, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

// The roomId is /party/[roomId] or /parties/[partyName]/[roomId]
function getRoomIdFromPathname(pathname: string) {
  // TODO: use a URLPattern here instead
  // TODO: might want to introduce a real router too
  if (pathname.startsWith("/party/")) {
    const [_, roomId] = pathname.split("/party/");
    return roomId;
  } else if (pathname.startsWith("/parties/")) {
    const [_, __, _partyName, roomId] = pathname.split("/");
    return roomId;
  }
}

const rehydratedConnections = new WeakMap<WebSocket, PartyKitConnection>();

function rehydrateHibernatedConnection(ws: WebSocket): PartyKitConnection {
  if (rehydratedConnections.has(ws)) {
    return rehydratedConnections.get(ws) as PartyKitConnection;
  }
  const connection = Object.assign(ws, {
    ...ws.deserializeAttachment(),
    socket: ws,
  }) as PartyKitConnection;

  rehydratedConnections.set(ws, connection);
  return connection;
}
let didWarnAboutMissingConnectionId = false;

class PartyDurable {}

type Env = {
  [key: string]: DurableObjectNamespace;
} & {
  PARTYKIT_VARS: Record<string, unknown>;
};

let parties: PartyKitRoom["parties"];

// create a "multi-party" object that can be used to connect to other parties
function createMultiParties(
  namespaces: Record<string, DurableObjectNamespace>,
  options: {
    host: string;
  }
) {
  if (!parties) {
    parties = {};
    for (const [key, value] of Object.entries(namespaces)) {
      if (typeof value.idFromName === "function") {
        parties[key] ||= {
          get: (name: string) => {
            const docId = value.idFromName(name).toString();
            const id = value.idFromString(docId);
            const stub = value.get(id);
            return {
              fetch(init?: RequestInit) {
                return stub.fetch(
                  key === "main"
                    ? `http://${options.host}/party/${name}`
                    : `http://${options.host}/parties/${key}/${name}`,
                  init
                );
              },
              connect: () => {
                // wish there was a way to create a websocket from a durable object
                return new WebSocket(
                  key === "main"
                    ? `ws://${options.host}/party/${name}`
                    : `ws://${options.host}/parties/${key}/${name}`
                );
              },
            };
          },
        };
      }
    }
  }

  return parties;
}

// we use a symbol as a sigil value to indicate
// that the room id hasn't been set yet
const UNDEFINED = Symbol("UNDEFINED");

function createDurable(Worker: PartyKitServer) {
  for (const handler of [
    "unstable_onFetch",
    "onConnect",
    "onBeforeConnect",
    "onRequest",
    "onBeforeRequest",
    "onMessage",
    "onClose",
    "onError",
    "onAlarm",
  ] satisfies (keyof PartyKitServer)[]) {
    if (handler in Worker && typeof Worker[handler] !== "function") {
      throw new Error(`.${handler} should be a function`);
    }
  }

  return class extends PartyDurable implements DurableObject {
    controller: DurableObjectState;
    room: PartyKitRoom;
    namespaces: Record<string, DurableObjectNamespace>;
    constructor(controller: DurableObjectState, env: Env) {
      super();

      const { PARTYKIT_VARS, PARTYKIT_DURABLE, ...namespaces } = env;

      this.controller = controller;
      this.namespaces = namespaces;

      Object.assign(this.namespaces, {
        main: PARTYKIT_DURABLE,
      });

      this.room = {
        // @ts-expect-error - id is a symbol when we start
        id: UNDEFINED, // using a string here because we're guaranteed to have set it before we use it
        internalID: this.controller.id.toString(),
        connections: new Map(),
        env: PARTYKIT_VARS,
        storage: this.controller.storage,
        parties: {},
        broadcast: this.broadcast,
      };

      if ("onMessage" in Worker) {
        // when using the Hibernation API, we'll initialize the connections map by deserializing
        // the sockets tracked by the platform. after this point, the connections map is kept up
        // to date as sockets connect/disconnect, until next hibernation
        this.room.connections = new Map(
          controller.getWebSockets().map((socket) => {
            const connection = rehydrateHibernatedConnection(socket);
            return [connection.id, connection];
          })
        );
      }
    }

    broadcast = (msg: string | Uint8Array, without: string[] = []) => {
      this.room.connections.forEach((connection) => {
        if (!without.includes(connection.id)) {
          connection.send(msg);
        }
      });
    };

    async fetch(request: Request) {
      const url = new URL(request.url);
      try {
        this.room.parties = createMultiParties(this.namespaces, {
          host: url.host,
        });

        // populate the room id/slug if not previously done so

        const roomId = getRoomIdFromPathname(url.pathname);

        assert(roomId, "No room id found in request url");
        this.room.id = roomId;

        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          if ("onRequest" in Worker) {
            if (typeof Worker.onRequest === "function") {
              return await Worker.onRequest(request, this.room);
            } else {
              return new Response("Invalid onRequest handler", {
                status: 500,
              });
            }
          }
        }
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : `${e}`;
        // @ts-expect-error - code is not a property on Error
        const errCode = "code" in e ? (e.code as number) : 500;
        return new Response(
          errMessage || "Uncaught exception when making a request",
          {
            status: errCode,
          }
        );
      }
      try {
        if (
          !(
            ("onConnect" in Worker && typeof Worker.onConnect === "function") ||
            ("onMessage" in Worker && typeof Worker.onMessage === "function")
          )
        ) {
          throw new Error("No onConnect or onMessage handler");
        }

        // Create the websocket pair for the client
        const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair();

        let connectionId = url.searchParams.get("_pk");
        if (!connectionId) {
          if (!didWarnAboutMissingConnectionId) {
            didWarnAboutMissingConnectionId = true;
          }
          connectionId = crypto.randomUUID();
        }

        // TODO: Object.freeze / mark as readonly!
        const connection: PartyKitConnection = Object.assign(serverWebSocket, {
          id: connectionId,
          socket: serverWebSocket,
          uri: request.url,
        });
        this.room.connections.set(connectionId, connection);

        const context = { request };

        // Accept the websocket connection
        if ("onMessage" in Worker || !(`onConnect` in Worker)) {
          this.controller.acceptWebSocket(serverWebSocket);
          connection.serializeAttachment({
            id: connectionId,
            uri: request.url,
          });

          if ("onConnect" in Worker && typeof Worker.onConnect === "function") {
            await Worker.onConnect(connection, this.room, context);
          }
        } else {
          serverWebSocket.accept();
          await this.handleConnection(this.room, connection, context);
        }

        return new Response(null, { status: 101, webSocket: clientWebSocket });
      } catch (e) {
        // Annoyingly, if we return an HTTP error
        // in response to a WebSocket request, Chrome devtools
        // won't show us the response body! So...
        // let's send a WebSocket response with an error frame instead.

        const errMessage = e instanceof Error ? e.message : `${e}`;
        const pair = new WebSocketPair();
        pair[1].accept();
        pair[1].close(1011, errMessage || "Uncaught exception when connecting");
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
    }

    async handleConnection(
      room: PartyKitRoom,
      connection: PartyKitConnection,
      context: PartyKitContext
    ) {
      assert(
        "onConnect" in Worker && typeof Worker.onConnect === "function",
        "No onConnect handler"
      );

      const handleCloseOrErrorFromClient = () => {
        // Remove the client from the room and delete associated user data.
        this.room.connections.delete(connection.id);

        connection.removeEventListener("close", handleCloseOrErrorFromClient);
        connection.removeEventListener("error", handleCloseOrErrorFromClient);

        if (room.connections.size === 0) {
          // TODO: implement this
        }
      };

      connection.addEventListener("close", handleCloseOrErrorFromClient);
      connection.addEventListener("error", handleCloseOrErrorFromClient);
      // and finally, connect the client to the worker
      // TODO: pass room id here? and other meta
      return Worker.onConnect(connection, room, context);
    }

    async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
      if ("onMessage" in Worker && typeof Worker.onMessage === "function") {
        const connection = rehydrateHibernatedConnection(ws);
        // @ts-expect-error - it may be a symbol before initialised
        if (this.room.id === UNDEFINED) {
          // This means the room "woke up" after hibernation
          // so we need to hydrate this.room again
          const { uri } = connection;
          assert(uri, "No uri found in connection");

          const url = new URL(uri);
          const roomId = getRoomIdFromPathname(url.pathname);
          assert(roomId, "No room id found in request url");

          this.room.id = roomId;
          this.room.parties = createMultiParties(this.namespaces, {
            host: url.host,
          });
        }

        return Worker.onMessage(msg, connection, this.room);
      }
    }

    async webSocketClose(ws: WebSocket) {
      const connection = rehydrateHibernatedConnection(ws);
      this.room.connections.delete(connection.id);

      if ("onClose" in Worker && typeof Worker.onClose === "function") {
        return Worker.onClose(connection, this.room);
      }
    }

    async webSocketError(ws: WebSocket, err: Error) {
      const connection = rehydrateHibernatedConnection(ws);
      this.room.connections.delete(connection.id);

      if ("onError" in Worker && typeof Worker.onError === "function") {
        return Worker.onError(connection, err, this.room);
      }
    }

    async alarm() {
      if (Worker.onAlarm) {
        return Worker.onAlarm(this.room);
      }
    }
  };
}

export const PartyKitDurable = createDurable(Worker);

__PARTIES__;
declare const __PARTIES__: Record<string, string>;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/parties/")) {
        const [_, __, partyName, docName] = url.pathname.split("/");
        const partyDO = env[partyName];
        if (!partyDO) {
          return new Response(`Party ${partyName} not found`, { status: 404 });
        }
        const docId = partyDO.idFromName(docName).toString();
        const id = partyDO.idFromString(docId);
        const ns = partyDO.get(id);
        return await ns.fetch(request);
      }

      const roomId = getRoomIdFromPathname(url.pathname);
      // TODO: throw if room is longer than x characters

      const { PARTYKIT_VARS, PARTYKIT_DURABLE, ...namespaces } = env;

      Object.assign(namespaces, {
        main: PARTYKIT_DURABLE,
      });

      const parties: PartyKitRoom["parties"] = createMultiParties(namespaces, {
        host: url.host,
      });

      if (roomId) {
        if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
          let connectionId = url.searchParams.get("_pk");
          if (!connectionId) {
            if (!didWarnAboutMissingConnectionId) {
              didWarnAboutMissingConnectionId = true;
            }
            connectionId = crypto.randomUUID();
          }

          // we should make this work, once we decide behaviour
          // isValidRequest?
          // onAuth?
          let onBeforeConnectResponse: Request | Response | undefined =
            undefined;
          if ("onBeforeConnect" in Worker) {
            if (typeof Worker.onBeforeConnect === "function") {
              try {
                onBeforeConnectResponse = await Worker.onBeforeConnect(
                  request,
                  {
                    id: roomId,
                    env: PARTYKIT_VARS,
                    parties,
                  },
                  ctx
                );
              } catch (e) {
                return new Response(
                  e instanceof Error ? e.message : `${e}` || "Unauthorised",
                  {
                    status: 401,
                  }
                );
              }
            } else {
              throw new Error(".onBeforeConnect must be a function");
            }
          }

          // Set up the durable object for this room
          const docId = PARTYKIT_DURABLE.idFromName(roomId).toString();
          const id = PARTYKIT_DURABLE.idFromString(docId);

          if (onBeforeConnectResponse) {
            if (onBeforeConnectResponse instanceof Response) {
              return onBeforeConnectResponse;
            } else if (onBeforeConnectResponse instanceof Request) {
              return await PARTYKIT_DURABLE.get(id).fetch(
                onBeforeConnectResponse
              );
            }
          }

          return await PARTYKIT_DURABLE.get(id).fetch(request);
        } else {
          let onBeforeRequestResponse: Request | Response = request;
          if ("onBeforeRequest" in Worker) {
            if (typeof Worker.onBeforeRequest === "function") {
              try {
                onBeforeRequestResponse = await Worker.onBeforeRequest(
                  request,
                  {
                    id: roomId,
                    env: PARTYKIT_VARS,
                    parties,
                  },
                  ctx
                );
              } catch (e) {
                return new Response(
                  e instanceof Error ? e.message : `${e}` || "Unauthorised",
                  {
                    status: 401,
                  }
                );
              }
            } else {
              throw new Error(".onBeforeRequest must be a function");
            }
          }

          // TODO: can this be faster?
          if (onBeforeRequestResponse instanceof Response) {
            return onBeforeRequestResponse;
          }
          if (!("onRequest" in Worker)) {
            throw new Error("No onRequest handler");
          }

          // Set up the durable object for this room
          const docId = PARTYKIT_DURABLE.idFromName(roomId).toString();
          const id = PARTYKIT_DURABLE.idFromString(docId);

          return await PARTYKIT_DURABLE.get(id).fetch(onBeforeRequestResponse);
        }
      } else {
        const staticAssetsResponse = await fetchStaticAsset(request, env, ctx);
        if (staticAssetsResponse) {
          return staticAssetsResponse;
        } else if ("unstable_onFetch" in Worker) {
          if (typeof Worker.unstable_onFetch === "function") {
            return await Worker.unstable_onFetch(
              request,
              {
                env: PARTYKIT_VARS,
                parties,
              },
              ctx
            );
          } else {
            throw new Error(".unstable_onFetch must be a function");
          }
        }

        return new Response("Not found", {
          status: 404,
        });
      }
    } catch (e) {
      return new Response(e instanceof Error ? e.message : `${e}`, {
        status: 500,
      });
    }
  },
};
