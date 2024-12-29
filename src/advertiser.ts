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

import { SSDP } from './ssdp';
import { EventEmitter } from 'events';
import Timer from '@gibme/timer';
import { v7 as uuid } from 'uuid';
import type { AddressInfo } from 'net';
import type { RemoteInfo } from 'dgram';

/**
 * A SSDP service advertiser that sends out service notifications based upon the
 * specified interval. The system will also reply automatically to `M-SEARCH` queries
 * for any services that we are an advertiser for. In addition, `upnp::rootdevice`,
 * `uuid:<uuid>` and `ssdp::all` messages are responded to automatically as necessary.
 */
export class Advertiser extends EventEmitter {
    protected readonly _services: Map<string, Headers> = new Map<string, Headers>();
    private readonly timer: Timer;
    private isDestroyed = false;

    /**
     * Creates a new instance of an SSDP advertiser
     * @param interval
     * @param uuid
     * @param socket
     * @param authenticationProvider
     * @protected
     */
    protected constructor (
        interval: number,
        public readonly uuid: string,
        private readonly socket: SSDP,
        private readonly authenticationProvider: (ipAddress: string) => Promise<boolean> | boolean
    ) {
        super();

        this.on('error', () => {});

        this.socket
            .on('error', error => this.emit('error', error))
            .on('search', (payload, local, remote) =>
                this.handle_payload(payload, local, remote));

        this.timer = new Timer(interval, true);
        this.timer
            .on('tick', () => this.notify_root_devices())
            .on('tick', () => this.notify(this._services))
            .tick();
    }

    /**
     * The advertiser's currently active services
     */
    public get services (): [string, Headers][] {
        return [...this._services.entries()];
    }

    /**
     * Constructs a new instance of a SSDP advertiser
     * @param options
     */
    public static async create (options: Partial<Advertiser.Options> = {}): Promise<Advertiser> {
        const socket = await SSDP.create(options);

        options.uuid ??= uuid();
        options.authenticationProvider ??= () => true;

        const advertiser = new Advertiser(
            options.interval || 60_000,
            options.uuid,
            socket,
            options.authenticationProvider);

        if (options.services) {
            for (const service of Object.keys(options.services)) {
                if (!(options.services[service] instanceof Headers)) {
                    options.services[service] = new Headers(options.services[service]);
                }

                advertiser._services.set(service, options.services[service]);
            }
        }

        return advertiser;
    }

    /**
     * Emitted when we receive an `M-SEARCH` message that we will handle
     * @param event
     * @param listener
     */
    public on (event: 'search', listener: (
        target: string,
        payload: SSDP.Search,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted when we encounter an error
     * @param event
     * @param listener
     */
    public on (event: 'error', listener: (error: Error) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Emitted when we receive an `M-SEARCH` message that we will handle
     * @param event
     * @param listener
     */
    public once (event: 'search', listener: (
        target: string,
        payload: SSDP.Search,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted when we encounter an error
     * @param event
     * @param listener
     */
    public once (event: 'error', listener: (error: Error) => void): this;

    public once (event: any, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    /**
     * Emitted when we receive an `M-SEARCH` message that we will handle
     * @param event
     * @param listener
     */
    public off (event: 'search', listener: (
        target: string,
        payload: SSDP.Search,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted when we encounter an error
     * @param event
     * @param listener
     */
    public off (event: 'error', listener: (error: Error) => void): this;

    public off (event: any, listener: (...args: any[]) => void): this {
        return super.off(event, listener);
    }

    /**
     * Adds the service to the advertiser
     * @param service
     * @param headers
     */
    public announce (service: string, headers: HeadersInit): void {
        if (!(headers instanceof Headers)) {
            headers = new Headers(headers);
        }

        if (!this._services.has(service)) {
            this.notify(new Map([[service, headers]]));
        }

        this._services.set(service, headers);
    }

    /**
     * Withdraws the service from the advertiser
     * @param service
     */
    public withdraw (service: string): boolean {
        if (this._services.has(service)) {
            this._services.delete(service);

            this.send_goodbye(service)
                .then(errors =>
                    errors.forEach(error =>
                        this.emit('error', error)));

            return true;
        } else {
            return false;
        }
    }

    /**
     * Destroys the instance
     */
    public destroy () {
        if (!this.isDestroyed) {
            this.isDestroyed = true;

            this.send_goodbyes()
                .finally(() => {
                    this.timer.destroy();

                    this.socket.destroy();
                });
        }
    }

    /**
     * Immediately sends `NOTIFY` messages for all services
     */
    public announceNow (): void {
        this.notify_root_devices();
        this.notify(this._services);
    };

    /**
     * Handles an incoming search payload
     * @param payload
     * @param local
     * @param remote
     * @private
     */
    private async handle_payload (
        payload: SSDP.Search,
        local: AddressInfo,
        remote: RemoteInfo
    ): Promise<boolean> {
        const man = payload.getHeader('MAN');
        const target = payload.getHeader('ST');

        if (man !== '"ssdp:discover"' || !target) return false;

        if (!await this.authenticationProvider(remote.address)) return false;

        const service = this._services.get(target);

        if (target === 'ssdp:all') {
            this.emit('search', target, payload, remote, local);

            return this.reply(payload, this._services);
        } else if (target === 'upnp:rootdevice') {
            this.emit('search', target, payload, remote, local);

            return this.reply(payload, new Map([[target, new Headers()]]));
        } else if (target === `uuid:${this.uuid}`) {
            this.emit('search', target, payload, remote, local);

            return this.reply(payload, new Map([[target, new Headers()]]));
        } else if (service) {
            this.emit('search', target, payload, remote, local);

            return this.reply(payload, new Map([[target, service]]));
        } else {
            this.emit('error', new Error(`Unknown target or service: ${target} || ${service}`));
        }

        return false;
    }

    /**
     * Sends a reply to a search for the specified services
     * @param request
     * @param services
     * @private
     */
    private reply (request: SSDP.Search, services: Map<string, Headers>): boolean {
        for (const [service, headers] of services.entries()) {
            const reply = new SSDP.Reply();

            headers.forEach((value, name) => reply.setHeader(name, value));

            reply.setHeader('ST', service);
            reply.setHeader('USN', `uuid:${this.uuid}::${service}`);

            this.socket.reply(request, reply)
                .then(errors =>
                    errors.forEach(error =>
                        this.emit('error', error)));
        }

        return true;
    }

    /**
     * Sends out root device & uuid notifications
     * @private
     */
    private notify_root_devices (): void {
        this.socket.notify('upnp:rootdevice', { USN: `uuid:${this.uuid}::upnp:rootdevice` })
            .then(errors =>
                errors.forEach(error =>
                    this.emit('error', error)));

        this.socket.notify(`uuid:${this.uuid}`, { USN: `uuid:${this.uuid}` })
            .then(errors =>
                errors.forEach(error =>
                    this.emit('error', error)));
    }

    /**
     * Sends notification message(s) for each of the services specified in the advertiser
     * @param services
     * @private
     */
    private notify (services: Map<string, Headers>): void {
        for (const [service, headers] of services.entries()) {
            headers.set('USN', `uuid:${this.uuid}::${service}`);

            this.socket.notify(service, headers)
                .then(errors =>
                    errors.forEach(error =>
                        this.emit('error', error)));
        }
    }

    /**
     * Sends ssdp::byebye messages for all the services we offer
     * @private
     */
    private async send_goodbyes (): Promise<void> {
        const errors = await this.socket.bye(`uuid:${this.uuid}`, { USN: `uuid:${this.uuid}` });

        errors.push(...await this.socket.bye('upnp:rootdevice', { USN: `uuid:${this.uuid}::upnp:rootdevice` }));

        for (const [service] of this._services.entries()) {
            errors.push(...await this.send_goodbye(service));
        }

        errors.forEach(error =>
            this.emit('error', error));
    }

    /**
     * Sends ssdp::byebye message for the specified service
     * @param service
     * @private
     */
    private async send_goodbye (service: string): Promise<Error[]> {
        return this.socket.bye(service, { USN: `uuid:${this.uuid}::${service}` });
    }
}

export namespace Advertiser {
    export type Options = Partial<SSDP.Options> & {
        /**
         * How often (in ms) we will advertise our service(s) to the network
         * @default 60000
         */
        interval: number;
        /**
         * The UUID for the instance of this server
         * @default new v7 UUID
         */
        uuid: string;
        /**
         * The initial services to advertise
         */
        services: Record<string, HeadersInit>;
        /**
         * The authentication provider that is used to validate whether we should respond
         * to search requests sent from the specified IP address
         *
         * Note: return `true` if we should respond and `false` if we should not respond
         * @param ipAddress
         * @default () => true
         */
        authenticationProvider: (ipAddress: string) => Promise<boolean> | boolean;
    }
}
