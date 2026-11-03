/** The transport rejected the operation before any RPC was emitted. */
export class RpcNotSentError extends Error {
    constructor(message = 'Socket not connected') {
        super(message);
        this.name = 'RpcNotSentError';
    }
}
