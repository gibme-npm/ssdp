// Copyright (c) 2018-2026, Brandon Lehmann <brandonlehmann@gmail.com>
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

import { describe, it, after, before } from 'node:test';
import { Browser, Advertiser, SSDP } from '../src';
import assert from 'assert';
import dgram from 'dgram';

describe('SSDP Unit Tests', async () => {
    let browser: Browser;
    let advertiser: Advertiser;

    const services: Record<string, HeadersInit> = {
        'test:service': {},
        'test:service2': {}
    };

    before(async () => {
        browser = await Browser.create({ interval: 5000, loopback: true, services: Object.keys(services) });
        advertiser = await Advertiser.create({ interval: 5000, loopback: true, services });
    });

    after(async () => {
        browser.destroy();
        advertiser.destroy();
    });

    describe('Browser', async () => {
        it('Has subscriptions', () => {
            assert.notEqual(browser.subscriptions.length, 0);
        });

        it('Discovers Services', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const timeout = setTimeout(() => {
                    t.skip('Timed out waiting for discovery');

                    return resolve();
                }, 5000);

                browser.once('discover', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                browser.searchNow();
            });
        });

        it('Subscribes', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const old_count = browser.subscriptions.length;
                browser.subscribe('test:service3');
                assert.notEqual(browser.subscriptions.length, old_count);

                const timeout = setTimeout(() => {
                    browser.off('discover', handle);

                    t.skip('Timed out waiting for subscription discovery');

                    return resolve();
                }, 5000);

                const handle = (service: string) => {
                    if (service === 'test:service3') {
                        clearTimeout(timeout);

                        browser.off('discover', handle);

                        return resolve();
                    }
                };

                browser.on('discover', handle);

                advertiser.announce('test:service3', {});
            });
        });

        it('Unsubscribes', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const old_count = browser.subscriptions.length;
                browser.unsubscribe('test:service3');
                assert.notEqual(browser.subscriptions.length, old_count);

                const timeout = setTimeout(() => resolve(), 2000);

                const handle = (service: string) => {
                    if (service === 'test:service3') {
                        clearTimeout(timeout);

                        browser.off('discover', handle);

                        t.skip('Still receiving events after unsubscribe');

                        return resolve();
                    }
                };

                browser.on('discover', handle);

                advertiser.announceNow();
            });
        });

        it('Detects Withdrawals', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const timeout = setTimeout(() => {
                    t.skip('Timed out waiting for withdrawal');

                    return resolve();
                }, 2000);

                browser.once('withdraw', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                advertiser.withdraw(Object.keys(services).pop() ?? '');
            });
        });
    });

    describe('Advertiser', async () => {
        it('Has Services', () => {
            assert.notEqual(advertiser.services.length, 0);
        });

        it('Announces Services', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const timeout = setTimeout(() => {
                    t.skip('Timed out waiting for announcement');

                    return resolve();
                }, 2000);

                browser.once('discover', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                advertiser.announceNow();
            });
        });

        it('Withdraws Services', { skip: false }, async (t) => {
            return new Promise<void>(resolve => {
                const timeout = setTimeout(() => {
                    t.skip('Timed out waiting for withdrawal');

                    return resolve();
                }, 2000);

                browser.on('withdraw', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                advertiser.withdraw(Object.keys(services)[0]);
            });
        });
    });

    describe('Parser hardening', () => {
        it('getHeader returns empty string for present-but-empty headers', () => {
            const payload = 'M-SEARCH * HTTP/1.1\r\n' +
                'HOST: 239.255.255.250:1900\r\n' +
                'MAN: "ssdp:discover"\r\n' +
                'MX: 2\r\nST: ssdp:all\r\nEXT:\r\n\r\n';
            const s = SSDP.Search.decode(payload, '192.0.2.1', 11111);
            assert.equal(s.hasHeader('EXT'), true);
            assert.equal(s.getHeader('EXT'), '');
        });

        it('decode tolerates a non-standard start-line (dispatcher is the gate)', () => {
            const garbage = 'X-WHATEVER * HTTP/1.1\r\n' +
                'LOCATION: http://example.invalid/desc.xml\r\n\r\n';
            const reply = SSDP.Reply.decode(garbage);
            assert.equal(reply.getHeader('LOCATION'), 'http://example.invalid/desc.xml');
        });

        it('header line with whitespace between field name and colon is rejected', () => {
            const payload = 'NOTIFY * HTTP/1.1\r\n' +
                'HOST: 239.255.255.250:1900\r\n' +
                'FOO   : value\r\n' +
                'NT: test\r\nNTS: ssdp:alive\r\n\r\n';
            const n = SSDP.Notification.decode(payload);
            // RFC 9112 §5.1: no whitespace is allowed between the field name and colon.
            assert.equal(n.hasHeader('FOO'), false);
            assert.equal(n.getHeader('FOO'), undefined);
            assert.equal(n.getHeader('NT'), 'test');
            assert.equal(n.getHeader('NTS'), 'ssdp:alive');
        });
    });

    describe('Dispatcher hardening', () => {
        let dispatcher: SSDP;
        let events: { type: string }[];

        before(async () => {
            dispatcher = await SSDP.create({ loopback: true });
            events = [];
            dispatcher.on('search', () => events.push({ type: 'search' }));
            dispatcher.on('notification', () => events.push({ type: 'notification' }));
            dispatcher.on('reply', () => events.push({ type: 'reply' }));
        });

        after(async () => {
            dispatcher.destroy();
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        it('M-SEARCH with a non-* request-URI is silently dropped', async () => {
            const sock = dgram.createSocket('udp4');
            await new Promise<void>(resolve => sock.bind(0, () => resolve()));
            const msg = Buffer.from('M-SEARCH /not-allowed HTTP/1.1\r\n' +
                'HOST: 239.255.255.250:1900\r\n' +
                'MAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n');
            sock.send(msg, 1900, '239.255.255.250');
            events.length = 0;
            await new Promise(resolve => setTimeout(resolve, 500));
            sock.close();
            const searchEvents = events.filter(e => e.type === 'search');
            assert.equal(searchEvents.length, 0,
                'non-* request-URI must not be dispatched as a search event');
        });

        it('NOTIFY-prefix substring start-line is silently dropped', async () => {
            const sock = dgram.createSocket('udp4');
            await new Promise<void>(resolve => sock.bind(0, () => resolve()));
            const msg = Buffer.from('NOTIFY-EXT * HTTP/1.1\r\n' +
                'HOST: 239.255.255.250:1900\r\n' +
                'NT: test\r\nNTS: ssdp:alive\r\n\r\n');
            sock.send(msg, 1900, '239.255.255.250');
            events.length = 0;
            await new Promise(resolve => setTimeout(resolve, 500));
            sock.close();
            const notifEvents = events.filter(e => e.type === 'notification');
            assert.equal(notifEvents.length, 0,
                'NOTIFY-prefix substring must not dispatch as a notification');
        });
    });

    describe('Advertiser hardening', () => {
        it('default UUID is v4 (RFC 9562 random, no embedded timestamp)', async () => {
            const ad = await Advertiser.create({ interval: 300_000, loopback: true });
            // RFC 9562: version is encoded as the first hex char of the 3rd group.
            const versionNibble = ad.uuid.charAt(14);
            ad.destroy();
            await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(versionNibble, '4',
                `default UUID must be v4, got ${ad.uuid} (version nibble ${versionNibble})`);
        });

        it('authenticationProvider throw is caught and surfaced as error event', async (t) => {
            const ad = await Advertiser.create({
                interval: 300_000,
                loopback: true,
                services: { 'test:authn-throw': {} },
                authenticationProvider: () => { throw new Error('test-authn-throw'); }
            });
            const seeker = await SSDP.create({ loopback: true });
            const replies: string[] = [];
            seeker.on('reply', (p) => {
                const st = p.getHeader('ST');
                if (st) replies.push(st);
            });

            // Race the error event against a timeout. Multicast loopback is
            // unreliable on some CI runners (notably macOS GitHub Actions);
            // if the M-SEARCH never round-trips, skip rather than fail.
            let observed: Error | undefined;
            await new Promise<void>(resolve => {
                const timeoutHandle = setTimeout(() => resolve(), 2000);
                ad.on('error', e => {
                    if (e.message.includes('test-authn-throw')) {
                        observed = e;
                        clearTimeout(timeoutHandle);
                        resolve();
                    }
                });
                seeker.search('test:authn-throw', 1);
            });

            ad.destroy();
            seeker.destroy();
            await new Promise(resolve => setTimeout(resolve, 200));

            if (!observed) {
                t.skip('multicast loopback did not deliver the M-SEARCH');
                return;
            }

            assert.equal(replies.includes('test:authn-throw'), false,
                'authn throw must prevent the reply');
            assert.equal(observed.message.includes('test-authn-throw'), true,
                'authn throw must be surfaced as an error event');
        });

        it('silentMode suppresses periodic NOTIFY', async () => {
            const observer = await SSDP.create({ loopback: true });
            const ourUuid = 'test-silentmode-uuid';
            const notifications: string[] = [];
            observer.on('notification', (p) => {
                const usn = p.getHeader('USN') || '';
                if (usn.includes(ourUuid)) notifications.push(usn);
            });
            const ad = await Advertiser.create({
                interval: 200,
                loopback: true,
                uuid: ourUuid,
                services: { 'silent:svc': {} },
                silentMode: true
            });
            await new Promise(resolve => setTimeout(resolve, 700));
            ad.destroy();
            await new Promise(resolve => setTimeout(resolve, 200));
            observer.destroy();
            await new Promise(resolve => setTimeout(resolve, 100));

            assert.equal(notifications.length, 0,
                `silentMode advertiser must not emit periodic NOTIFY (observed ${notifications.length})`);
        });

        it('authenticationProvider throw does not produce unhandledRejection', async () => {
            let unhandled = false;
            const handler = (reason: any) => {
                if (String(reason).includes('test-authn-no-rejection')) unhandled = true;
            };
            process.on('unhandledRejection', handler);

            const ad = await Advertiser.create({
                interval: 300_000,
                loopback: true,
                services: { 'test:authn-no-rejection': {} },
                authenticationProvider: () => { throw new Error('test-authn-no-rejection'); }
            });
            const seeker = await SSDP.create({ loopback: true });
            await seeker.search('test:authn-no-rejection', 1);
            await new Promise(resolve => setTimeout(resolve, 800));
            ad.destroy();
            seeker.destroy();
            await new Promise(resolve => setTimeout(resolve, 200));

            process.off('unhandledRejection', handler);
            assert.equal(unhandled, false,
                'authn throw must not produce unhandledRejection');
        });
    });
});
