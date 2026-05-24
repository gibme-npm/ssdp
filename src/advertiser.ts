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

import { SSDP, type HeadersInit } from './ssdp';
import { EventEmitter } from 'events';
import Timer from '@gibme/timer';
import { v4 as uuid } from 'uuid';
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
     * @param silentMode
     * @protected
     */
    protected constructor (
        interval: number,
        public readonly uuid: string,
        private readonly socket: SSDP,
        private readonly authenticationProvider: (ipAddress: string) => Promise<boolean> | boolean,
        private readonly silentMode: boolean = false
    ) {
        super();

        this.on('error', () => {});

        this.socket
            .on('error', error => this.emit('error', error))
            .on('search', (payload, local, remote) =>
                this.handle_payload(payload, local, remote));

        this.timer = new Timer(interval, true);
        // When silentMode is on, do not announce ourselves on the network. We
        // remain reachable only via direct M-SEARCH (still subject to authn).
        if (!this.silentMode) {
            this.timer
                .on('tick', () => this.notify_root_devices())
                .on('tick', () => this.notify(this._services))
                .tick();
        }
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

        // Reject empty-string uuid as a fail-open footgun (would make
        // `target === \`uuid:${this.uuid}\`` collapse to matching `uuid:`).
        // Default to RFC 9562 v4 random rather than v7 to avoid leaking the
        // device-creation wall-clock timestamp via every USN broadcast.
        if (!options.uuid) options.uuid = uuid();
        options.authenticationProvider ??= () => true;

        const advertiser = new Advertiser(
            options.interval || 60_000,
            options.uuid,
            socket,
            options.authenticationProvider,
            options.silentMode ?? false);

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
     * Handles an incoming search payload.
     *
     * Dispatch order:
     *  1. Validate MAN and ST headers per draft-cai-ssdp v1 §4.2.
     *  2. Decide which services (if any) we owe a reply for. Unknown / unregistered
     *     STs are silently dropped per the SSDP convention (an M-SEARCH ST that
     *     does not apply is "not for us").
     *  3. Only then call authenticationProvider, so wasted authn work and any
     *     attacker-controlled string never reaches the provider for STs we will
     *     not answer. Wrap the provider in try/catch and fail closed on throw.
     *  4. Delay the reply by a random interval in [0, MX] seconds per UPnP DA
     *     to mitigate the multicast-amplification reply storm.
     *
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

        // Build the reply set the M-SEARCH actually requires before consulting
        // authn. Returns null if we do not advertise anything matching `target`.
        const replyServices = this.build_reply_set(target);
        if (!replyServices) return false;

        let allowed = false;
        try {
            allowed = await this.authenticationProvider(remote.address);
        } catch (error: any) {
            // Authentication provider failures fail closed. The error is
            // surfaced for observability but we never proceed to reply.
            this.emit('error', new Error(
                `authenticationProvider threw for ${remote.address}: ${error?.message ?? error}`));
            return false;
        }
        if (!allowed) return false;

        this.emit('search', target, payload, remote, local);

        // UPnP DA: SHOULD wait a random interval in [0, MX] seconds before
        // responding to a multicast M-SEARCH. Parse MX defensively; clamp
        // out-of-range / non-numeric to the lower spec bound (1s) to bound
        // worst-case delay while still spreading the reply storm.
        const mxStr = payload.getHeader('MX');
        const mxParsed = mxStr !== undefined ? parseInt(mxStr, 10) : NaN;
        const mx = Number.isFinite(mxParsed) && mxParsed >= 1 && mxParsed <= 5 ? mxParsed : 1;
        const delayMs = Math.floor(Math.random() * mx * 1000);

        setTimeout(() => {
            if (this.isDestroyed) return;
            this.reply(payload, replyServices);
        }, delayMs);

        return true;
    }

    /**
     * Returns the (service → headers) map we should reply with for the given
     * M-SEARCH ST, or `null` if this advertiser does not answer to `target`.
     *
     * Per UPnP DA, an `ssdp:all` query MUST be answered with one response per
     * root device (`upnp:rootdevice`), one per device UUID (`uuid:<UUID>`), and
     * one per advertised service type. `upnp:rootdevice` and `uuid:<UUID>` are
     * also valid standalone STs that resolve to a single reply each.
     *
     * @param target
     * @private
     */
    private build_reply_set (target: string): Map<string, Headers> | null {
        if (target === 'ssdp:all') {
            const set = new Map<string, Headers>();
            set.set('upnp:rootdevice', new Headers());
            set.set(`uuid:${this.uuid}`, new Headers());
            for (const [service, headers] of this._services.entries()) {
                set.set(service, headers);
            }
            return set;
        }
        if (target === 'upnp:rootdevice') {
            return new Map([[target, new Headers()]]);
        }
        if (target === `uuid:${this.uuid}`) {
            return new Map([[target, new Headers()]]);
        }
        const service = this._services.get(target);
        if (service) {
            return new Map([[target, service]]);
        }
        return null;
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
        if (this.silentMode) return;

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
        if (this.silentMode) return;

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
        if (this.silentMode) return;

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
        if (this.silentMode) return [];

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
         * The UUID for the instance of this server.
         *
         * The default is a fresh RFC 9562 v4 (random) UUID. UPnP DA expects
         * device UUIDs to be stable across reboots; if you want that, generate
         * one once at install time, persist it, and pass it here every run.
         * Avoid v1 (leaks MAC) and v7 (leaks creation wall-clock timestamp via
         * every USN multicast).
         *
         * @default new v4 UUID
         */
        uuid: string;
        /**
         * The initial services to advertise
         */
        services: Record<string, HeadersInit>;
        /**
         * Gates unicast responses to incoming M-SEARCH requests by remote IP.
         * Returns true to allow the response, false to silently drop.
         *
         * This callback ONLY governs unicast replies. Outbound multicast
         * NOTIFY / ssdp:alive / ssdp:byebye are sent to the multicast group
         * without consulting this callback. If you need the advertiser to stay
         * silent on the wire and only respond to direct queries, also set
         * `silentMode: true`.
         *
         * If the callback throws, the request fails closed.
         *
         * @param ipAddress
         * @default () => true
         */
        authenticationProvider: (ipAddress: string) => Promise<boolean> | boolean;
        /**
         * When true, the advertiser does not periodically multicast NOTIFY
         * ssdp:alive, does not multicast ssdp:byebye on destroy, and does not
         * react to its own interval timer. It still answers unicast M-SEARCH
         * requests that pass {@link authenticationProvider}.
         *
         * Use this when SSDP discoverability should be initiated by the
         * requester (pull) rather than announced (push), or when the
         * advertiser should appear only to authorized querents.
         *
         * @default false
         */
        silentMode: boolean;
    }
}
