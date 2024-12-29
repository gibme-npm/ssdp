// Copyright (c) 2018-2024, Brandon Lehmann <brandonlehmann@gmail.com>
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
import type { RemoteInfo } from 'dgram';
import type { AddressInfo } from 'net';
import { EventEmitter } from 'events';
import Timer from '@gibme/timer';

/**
 * A SSDP browser will look for and emit an event for the service types that
 * it has been subscribed to. The full message payload is provided in
 * the emitted events.
 */
export class Browser extends EventEmitter {
    protected readonly _searchTargets: Set<string> = new Set<string>();
    private readonly timer: Timer;

    /**
     * Constructs a new instance of the browser
     * @param interval
     * @param socket
     */
    protected constructor (
        interval: number,
        private readonly socket: SSDP
    ) {
        super();

        this.on('error', () => {});

        this.socket
            .on('error', error => this.emit('error', error))
            .on('notification', (payload, local, remote) => {
                const target = payload.getHeader('NT');

                if (target) {
                    this.handle_payload(target, payload, remote, local);
                }
            })
            .on('reply', (payload, local, remote) => {
                const target = payload.getHeader('ST');

                if (target) {
                    this.handle_payload(target, payload, remote, local);
                }
            });

        this.timer = new Timer(interval, true);
        this.timer.on('tick', () => this.browse([...this._searchTargets.values()])).tick();
    }

    /**
     * The browser's currently active search targets
     */
    public get subscriptions (): string[] {
        return [...this._searchTargets.values()];
    }

    /**
     * Constructs a new instance of a SSDP browser
     * @param options
     */
    public static async create (options: Partial<Browser.Options> = {}): Promise<Browser> {
        const socket = await SSDP.create(options);

        const browser = new Browser(options.interval || 60_000, socket);

        if (options.services) {
            if (Array.isArray(options.services)) {
                for (const target of options.services) {
                    browser._searchTargets.add(target);
                }
            } else {
                browser._searchTargets.add(options.services);
            }
        }

        return browser;
    }

    /**
     * Emitted whenever we receive either a reply to our search/query or notification
     * that a service that we have subscribed to is available
     * @param event
     * @param listener
     */
    public on (event: 'discover', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted whenever we receive a `ssdp:bybye` message for a service that we have
     * subscribed to
     * @param event
     * @param listener
     */
    public on (event: 'withdraw', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
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
     * Emitted whenever we receive either a reply to our search/query or notification
     * that a service that we have subscribed to is available
     * @param event
     * @param listener
     */
    public once (event: 'discover', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted whenever we receive a `ssdp:bybye` message for a service that we have
     * subscribed to
     * @param event
     * @param listener
     */
    public once (event: 'withdraw', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
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
     * Emitted whenever we receive either a reply to our search/query or notification
     * that a service that we have subscribed to is available
     * @param event
     * @param listener
     */
    public off (event: 'discover', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
    ) => void): this;

    /**
     * Emitted whenever we receive a `ssdp:bybye` message for a service that we have
     * subscribed to
     * @param event
     * @param listener
     */
    public off (event: 'withdraw', listener: (
        service: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
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
     * Triggers sending out search messages immediately
     */
    public searchNow (): void {
        this.browse([...this._searchTargets.values()]);
    }

    /**
     * Adds the specified search target to the browser
     * @param service
     */
    public subscribe (service: string) {
        if (service === '*') {
            service = 'ssdp:all';
        }

        if (!this._searchTargets.has(service)) {
            this.browse([service]);
        }

        this._searchTargets.add(service);
    }

    /**
     * Removes the specified search target from the browser
     * @param service
     */
    public unsubscribe (service: string): boolean {
        return this._searchTargets.delete(service);
    }

    /**
     * Destroys the browser
     */
    public destroy () {
        this.timer.destroy();

        this.socket.destroy();
    }

    /**
     * Handles incoming payloads
     * @param target
     * @param payload
     * @param remote
     * @param local
     * @private
     */
    private handle_payload (
        target: string,
        payload: SSDP.Reply | SSDP.Notification,
        remote: RemoteInfo,
        local: AddressInfo
    ): boolean {
        if (this._searchTargets.has(target)) {
            if (payload.isReply) {
                return this.emit('discover', target, payload, remote, local);
            }

            const nts = payload.getHeader('NTS');

            if (nts === 'ssdp:alive' || nts === 'ssdp:update') {
                return this.emit('discover', target, payload, remote, local);
            } else if (nts === 'ssdp:byebye') {
                return this.emit('withdraw', target, payload, remote, local);
            }
        }

        return false;
    }

    /**
     * Sends search message(s) for each of the search targets specified in the browser
     * @param searchTargets
     * @private
     */
    private browse (searchTargets: string | string[]): void {
        if (!Array.isArray(searchTargets)) {
            searchTargets = [searchTargets];
        }

        if (searchTargets.length === 0) return;

        for (const target of searchTargets) {
            this.socket.search(target)
                .then(errors =>
                    errors.forEach(error =>
                        this.emit('error', error)));
        }
    }
}

export namespace Browser {
    export type Options = Partial<SSDP.Options> & {
        /**
         * How often (in ms) to poll the network for the search targets
         * @default 60000
         */
        interval: number;
        /**
         * The initial search targets the browser should check for
         */
        services: string | string[];
    }
}
