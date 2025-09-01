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

import { describe, it, after, before } from 'mocha';
import { Browser, Advertiser } from '../src';
import assert from 'assert';

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

        it('Discovers Services', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const timeout = setTimeout(() => {
                    $this.skip();

                    return resolve();
                }, 5000);

                browser.once('discover', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                browser.searchNow();
            });
        });

        it('Subscribes', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const old_count = browser.subscriptions.length;
                browser.subscribe('test:service3');
                assert.notEqual(browser.subscriptions.length, old_count);

                const timeout = setTimeout(() => {
                    browser.off('discover', handle);

                    $this.skip();

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

        it('Unsubscribes', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const old_count = browser.subscriptions.length;
                browser.unsubscribe('test:service3');
                assert.notEqual(browser.subscriptions.length, old_count);

                const timeout = setTimeout(() => resolve(), 2000);

                const handle = (service: string) => {
                    if (service === 'test:service3') {
                        clearTimeout(timeout);

                        browser.off('discover', handle);

                        $this.skip();

                        return resolve();
                    }
                };

                browser.on('discover', handle);

                advertiser.announceNow();
            });
        });

        it('Detects Withdrawals', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const timeout = setTimeout(() => {
                    $this.skip();

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

        it('Announces Services', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const timeout = setTimeout(() => {
                    $this.skip();

                    return resolve();
                }, 2000);

                browser.once('discover', () => {
                    clearTimeout(timeout);

                    return resolve();
                });

                advertiser.announceNow();
            });
        });

        it('Withdraws Services', async function () {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const $this = this;

            return new Promise(resolve => {
                const timeout = setTimeout(() => {
                    $this.skip();

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
});
