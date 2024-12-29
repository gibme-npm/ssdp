// Copyright (c) 2018-2025, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import MulticastSocket from '@gibme/multicast';
import type { RemoteInfo } from 'dgram';
import type { AddressInfo } from 'net';
import { EventEmitter } from 'events';

/**
 * Wraps a multicast socket implementation into an instance of a SSDP handler
 */
export class SSDP extends EventEmitter {
    /**
     * Creates a new instance of a SSDP socket
     * @param socket
     * @protected
     */
    protected constructor (private readonly socket: MulticastSocket) {
        super();

        this.socket.on('message', (msg: Buffer, local: AddressInfo, remote: RemoteInfo, fromSelf: boolean) => {
            const message = msg.toString();

            const handle_error = (type: string, error: any) => {
                const errorMessage = error ? error.message ?? error.toString() : 'Unknown error';

                this.emit('error', new Error(`[${type}] ${errorMessage}:\n${message}`));
            };

            if (message.startsWith('M-SEARCH')) {
                try {
                    const payload = SSDP.Search.decode(message, remote.address, remote.port);

                    const man = payload.getHeader('MAN');

                    if (man === '"ssdp:discover"' && payload.hasHeader('ST')) {
                        this.emit('search', payload, local, remote, fromSelf);
                    }
                } catch (error: any) {
                    handle_error('M-SEARCH', error);
                }
            } else if (message.startsWith('NOTIFY')) {
                try {
                    const payload = SSDP.Notification.decode(message);

                    this.emit('notification', payload, local, remote, fromSelf);
                } catch (error: any) {
                    handle_error('NOTIFY', error);
                }
            } else {
                try {
                    const payload = SSDP.Reply.decode(message);

                    this.emit('reply', payload, local, remote, fromSelf);
                } catch (error: any) {
                    handle_error('REPLY', error);
                }
            }
        });
    }

    /**
     * Creates a new instance of the object
     * @param options
     */
    public static async create (options: Partial<SSDP.Options> = {}): Promise<SSDP> {
        options.ttl ||= 2;

        const socket = await MulticastSocket.create({
            ...options,
            port: 1900,
            multicastGroup: '239.255.255.250'
        });

        socket.setTTL(options.ttl);

        return new SSDP(socket);
    }

    /**
     * Emitted whenever we receive an `M-SEARCH` message
     * @param event
     * @param listener
     */
    public on (event: 'search', listener: (
        payload: SSDP.Search,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a `NOTIFY` message
     * @param event
     * @param listener
     */
    public on (event: 'notification', listener: (
        payload: SSDP.Notification,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a reply message
     * @param event
     * @param listener
     */
    public on (event: 'reply', listener: (
        payload: SSDP.Reply,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we encounter an error
     * @param event
     * @param listener
     */
    public on (event: 'error', listener: (error: Error) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Emitted whenever we receive an `M-SEARCH` message
     * @param event
     * @param listener
     */
    public once (event: 'search', listener: (
        payload: SSDP.Search,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a `NOTIFY` message
     * @param event
     * @param listener
     */
    public once (event: 'notification', listener: (
        payload: SSDP.Notification,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a reply message
     * @param event
     * @param listener
     */
    public once (event: 'reply', listener: (
        payload: SSDP.Reply,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we encounter an error
     * @param event
     * @param listener
     */
    public once (event: 'error', listener: (error: Error) => void): this;

    public once (event: any, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    /**
     * Emitted whenever we receive an `M-SEARCH` message
     * @param event
     * @param listener
     */
    public off (event: 'search', listener: (
        payload: SSDP.Search,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a `NOTIFY` message
     * @param event
     * @param listener
     */
    public off (event: 'notification', listener: (
        payload: SSDP.Notification,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we receive a reply message
     * @param event
     * @param listener
     */
    public off (event: 'reply', listener: (
        payload: SSDP.Reply,
        local: AddressInfo,
        remote: RemoteInfo,
        fromSelf: boolean
    ) => void): this;

    /**
     * Emitted whenever we encounter an error
     * @param event
     * @param listener
     */
    public off (event: 'error', listener: (error: Error) => void): this;

    public off (event: any, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    /**
     * Sends an M-SEARCH packet to the network via multicast
     * @param serviceType
     * @param wait_time
     * @param headers
     */
    public async search (
        serviceType: string,
        wait_time = 3,
        headers: HeadersInit = new Headers()
    ): Promise<Error[]> {
        if (wait_time < 1 || wait_time > 5) {
            throw new Error(`Invalid wait time: ${wait_time}. Must be between 1 and 5 seconds.`);
        }

        const message = new SSDP.Search('239.255.255.250', 1900);

        if (!(headers instanceof Headers)) {
            headers = new Headers(headers);
        }

        headers.forEach((value, key) => {
            message.setHeader(key, value);
        });

        message.setHeader('MAN', '"ssdp:discover"');
        message.setHeader('HOST', '239.255.255.250:1900');
        message.setHeader('ST', serviceType);
        message.setHeader('MX', wait_time);

        if (!message.hasHeader('EXT')) {
            message.setHeader('EXT', '');
        }

        return this._sendMessage(message);
    }

    /**
     * Sends a NOTIFY message, as an `ssdp:alive`, to the network as a multicast packet
     * @param serviceType
     * @param headers
     */
    public async notify (serviceType: string, headers: HeadersInit = new Headers()): Promise<Error[]> {
        const message = new SSDP.Notification();

        if (!(headers instanceof Headers)) {
            headers = new Headers(headers);
        }

        headers.forEach((value, key) => {
            message.setHeader(key, value);
        });

        message.setHeader('HOST', '239.255.255.250:1900');
        message.setHeader('NT', serviceType);
        message.setHeader('NTS', 'ssdp:alive');

        return this._sendMessage(message);
    }

    /**
     * Sends a NOTIFY message, as an `ssdp:update`, to the network as a multicast packet
     * @param serviceType
     * @param headers
     */
    public async update (serviceType: string, headers: HeadersInit = new Headers()): Promise<Error[]> {
        const message = new SSDP.Notification();

        if (!(headers instanceof Headers)) {
            headers = new Headers(headers);
        }

        headers.forEach((value, key) => {
            message.setHeader(key, value);
        });

        message.setHeader('HOST', '239.255.255.250:1900');
        message.setHeader('NT', serviceType);
        message.setHeader('NTS', 'ssdp:update');

        return this._sendMessage(message);
    }

    /**
     * Sends a NOTIFY message, as an `ssdp:byebye`, to the network as a multicast packet
     * @param serviceType
     * @param headers
     */
    public async bye (serviceType: string, headers: HeadersInit = new Headers()): Promise<Error[]> {
        const message = new SSDP.Notification();

        if (!(headers instanceof Headers)) {
            headers = new Headers(headers);
        }

        headers.forEach((value, key) => {
            message.setHeader(key, value);
        });

        message.setHeader('HOST', '239.255.255.250:1900');
        message.setHeader('NT', serviceType);
        message.setHeader('NTS', 'ssdp:byebye');

        return this._sendMessage(message);
    }

    /**
     * Sends a Reply (response) message to requestor using unicast as required
     * by the SSDP RFCs
     * @param request
     * @param response
     */
    public async reply (request: SSDP.Search, response: SSDP.Reply): Promise<Error[]> {
        return this._sendMessage(response, request.host, request.port);
    }

    /**
     * Destroys the instance
     */
    public destroy () {
        this.socket.destroy();
    }

    /**
     * Sends a DNS packet via the socket
     * @param message
     * @param dstAddress
     * @param dstPort
     * @protected
     */
    protected async _sendMessage (
        message: SSDP.Search | SSDP.Notification | SSDP.Reply,
        dstAddress?: string,
        dstPort?: number
    ): Promise<Error[]> {
        return this.socket.send(message.toBuffer(), {
            dstAddress,
            dstPort
        });
    }
}

export namespace SSDP {
    export type Options = {
        /**
         * The host interface to bind the instance to
         */
        host: string;
        /**
         * Whether our sockets should also receive the messages that are sent
         */
        loopback: boolean;
        /**
         * The TTL of the underlying multicast socket
         * @default 2
         */
        ttl: number;
    }

    /**
     * Implements a SSDP payload
     */
    abstract class Payload {
        /**
         * Constructs a new instance of a payload
         * @param method
         * @param isReply
         * @protected
         */
        // eslint-disable-next-line no-useless-constructor
        protected constructor (
            public readonly method: 'm-search' | 'notify' | 'reply',
            public readonly isReply = false
        ) {
        }

        /**
         * Returns whether this is a `ssdp::byebye` message
         */
        public get isByeBye (): boolean {
            return this.getHeader('NTS') === 'ssdp:byebye';
        }

        /**
         * Returns whether this is a `ssdp:alive` message
         */
        public get isAlive (): boolean {
            return this.getHeader('NTS') === 'ssdp:alive';
        }

        /**
         * Returns whether this is as `ssdp:update` message
         */
        public get isUpdate (): boolean {
            return this.getHeader('NTS') === 'ssdp:update';
        }

        private _headers: Headers = new Headers();

        /**
         * Returns the headers contained in the payload
         * @protected
         */
        protected get headers (): Headers {
            return this._headers;
        }

        /**
         * Sets the headers contained in the payload
         * @param value
         * @protected
         */
        protected set headers (value: Headers) {
            this._headers = value;
        }

        /**
         * Decodes the headers from the specified payload
         * @param payload
         * @protected
         */
        protected static _decode (payload: Buffer | string): Headers {
            if (typeof payload !== 'string') {
                payload = payload.toString();
            }

            const lines = payload.split('\n').slice(1)
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const headers = new Headers();

            for (const line of lines) {
                const [key, ...value] = line.split(':')
                    .map(part => part.trim());

                if (key && value.length > 0) {
                    headers.set(key.toUpperCase(), value.join(':').trim());
                }
            }

            return headers;
        }

        /**
         * Sets the specified header to the specified value
         * @param key
         * @param value
         */
        public setHeader (key: string, value: string | number) {
            key = key.trim().toUpperCase();

            if (typeof value === 'number') {
                value = value.toString();
            }

            value = value.trim();

            this._headers.set(key, value);
        }

        /**
         * Deletes the specified header
         * @param key
         */
        public deleteHeader (key: string): void {
            key = key.trim().toUpperCase();

            return this._headers.delete(key);
        }

        /**
         * Returns whether the specified header exists
         * @param key
         */
        public hasHeader (key: string): boolean {
            key = key.trim().toUpperCase();

            return this._headers.has(key);
        }

        /**
         * Attempts to retrieve the specified header
         * @param key
         */
        public getHeader (key: string): string | undefined {
            key = key.trim().toUpperCase();

            return this._headers.get(key) || undefined;
        }

        /**
         * Clears all the headers
         */
        public clearHeaders (): void {
            return this._headers.forEach((_value, key) => this._headers.delete(key));
        }

        /**
         * Returns a string representation of the instance
         */
        public toString (): string {
            const message: string[] = [];

            switch (this.method) {
                case 'reply':
                    message.push('HTTP/1.1 200 OK');
                    break;
                case 'notify':
                case 'm-search':
                    message.push(`${this.method.toUpperCase()} * HTTP/1.1`);
            }

            const headers: string[][] = [];

            this._headers.forEach((value, key) => {
                headers.push([key, value]);
            });

            for (const [key, value] of headers.sort((a, b) => a[0].localeCompare(b[0]))) {
                message.push(`${key.toUpperCase()}: ${value}`);
            }

            message.push('\r\n');

            return message.join('\r\n');
        }

        /**
         * Returns a Buffer representation of the object
         */
        public toBuffer (): Buffer {
            return Buffer.from(this.toString());
        }
    }

    /**
     * Represents an M-SEARCH payload
     */
    export class Search extends Payload {
        /**
         * Constructs a new instance of the object
         * @param host
         * @param port
         */
        constructor (public readonly host: string, public readonly port: number) {
            super('m-search', false);
        }

        /**
         * Decodes a payload into an instance of the object
         * @param payload
         * @param host
         * @param port
         */
        public static decode (payload: Buffer | string, host: string, port: number): Search {
            const message = new Search(host, port);

            message.headers = Payload._decode(payload);

            return message;
        }
    }

    export class Notification extends Payload {
        /**
         * Constructs a new instance of the object
         */
        constructor () {
            super('notify', false);
        }

        /**
         * Decodes a payload into an instance of the object
         * @param payload
         */
        public static decode (payload: Buffer | string): Notification {
            const message = new Notification();

            message.headers = Payload._decode(payload);

            return message;
        }
    }

    export class Reply extends Payload {
        /**
         * Creates a new instance of the object
         */
        constructor () {
            super('reply', true);
        }

        /**
         * Decodes a payload into an instance of the object
         * @param payload
         */
        public static decode (payload: Buffer | string): Reply {
            const message = new Reply();

            message.headers = Payload._decode(payload);

            return message;
        }
    }

}
