/**
 * @supa-media/chat — Adapter interface and implementations
 *
 * The ChatAdapter defines the contract between the chat UI layer and the
 * backend. Implement this interface to plug in any real-time data source.
 */

export { type ChatAdapter } from "./ChatAdapter";
export { ConvexChatAdapter } from "./ConvexChatAdapter";
