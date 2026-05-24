# @gibme/ssdp

A lightweight [SSDP](https://en.wikipedia.org/wiki/Simple_Service_Discovery_Protocol) (Simple Service Discovery Protocol) implementation for Node.js with full TypeScript support.

## Requirements

- Node.js >= 22

## Installation

```bash
npm install @gibme/ssdp
```

or

```bash
yarn add @gibme/ssdp
```

## Documentation

[https://gibme-npm.github.io/ssdp](https://gibme-npm.github.io/ssdp)

## Features

### Browser

Discover SSDP services on the network with automatic periodic searching.

- Subscribes to specific service types and emits events on discovery or withdrawal
- Dynamic subscription and unsubscription at runtime
- Configurable search interval
- Emits `discover` events for `ssdp:alive`, `ssdp:update`, and search replies
- Emits `withdraw` events for `ssdp:byebye` notifications

### Advertiser

Announce SSDP services on the network with automatic periodic notifications.

- Automatically handles incoming `M-SEARCH` requests for:
  - `upnp:rootdevice`
  - `uuid:<uuid>`
  - `ssdp:all`
  - Any registered service types
- Dynamic service announcement and withdrawal at runtime
- Configurable notification interval
- UUID v7 auto-generation for device identity
- Optional authentication provider to control which hosts receive responses

## Usage

### Discovering Services

```typescript
import { Browser } from '@gibme/ssdp';

const browser = await Browser.create({
    interval: 5_000,
    services: ['urn:schemas-upnp-org:device:MediaServer:1']
});

browser.on('discover', (service, payload, remote, local) => {
    console.log('Discovered:', { service, remote: remote.address });
});

browser.on('withdraw', (service, payload, remote, local) => {
    console.log('Withdrawn:', { service, remote: remote.address });
});

// Trigger an immediate search
browser.searchNow();

// Subscribe to additional services dynamically
browser.subscribe('urn:schemas-upnp-org:device:InternetGatewayDevice:1');

// Unsubscribe from a service
browser.unsubscribe('urn:schemas-upnp-org:device:MediaServer:1');

// Clean up when done
browser.destroy();
```

### Advertising Services

```typescript
import { Advertiser } from '@gibme/ssdp';

const advertiser = await Advertiser.create({
    interval: 5_000,
    services: {
        'urn:schemas-upnp-org:device:MediaServer:1': {
            'LOCATION': 'http://192.168.1.100:8080/description.xml'
        }
    }
});

// Announce a new service dynamically
advertiser.announce('urn:schemas-upnp-org:service:ContentDirectory:1', {
    'LOCATION': 'http://192.168.1.100:8080/content.xml'
});

// Withdraw a specific service
advertiser.withdraw('urn:schemas-upnp-org:service:ContentDirectory:1');

// Trigger an immediate notification for all services
advertiser.announceNow();

// Clean up when done (sends ssdp:byebye for all services)
advertiser.destroy();
```

### Using the Authentication Provider

Control which hosts can discover your services:

```typescript
import { Advertiser } from '@gibme/ssdp';

const allowedSubnets = ['192.168.1.', '10.0.0.'];

const advertiser = await Advertiser.create({
    interval: 10_000,
    services: {
        'my:custom:service': {}
    },
    authenticationProvider: (ipAddress) => {
        return allowedSubnets.some(subnet => ipAddress.startsWith(subnet));
    }
});
```

### Low-Level SSDP Socket

For direct control over SSDP messaging:

```typescript
import { SSDP } from '@gibme/ssdp';

const socket = await SSDP.create({ loopback: true, ttl: 2 });

socket.on('search', (payload, local, remote) => {
    console.log('Search from:', remote.address, 'for:', payload.getHeader('ST'));
});

socket.on('notification', (payload, local, remote) => {
    console.log('Notification:', payload.getHeader('NT'), payload.getHeader('NTS'));
});

socket.on('reply', (payload, local, remote) => {
    console.log('Reply:', payload.getHeader('ST'));
});

// Send a search
await socket.search('ssdp:all');

// Send a notification
await socket.notify('my:service:type', { USN: 'uuid:my-device::my:service:type' });

// Send a byebye
await socket.bye('my:service:type', { USN: 'uuid:my-device::my:service:type' });

socket.destroy();
```

## Configuration Options

### Common Options

| Option | Type | Default | Description |
|---|---|---|---|
| `host` | `string` | auto | Network interface to bind to |
| `loopback` | `boolean` | `false` | Whether to receive messages sent by this instance |
| `linkLocalOnly` | `boolean` | `false` | When `true`, drop inbound packets whose source is not on a local-link subnet (RFC 6762 §11-style hardening). SSDP runs on the administratively-scoped group `239.255.255.250` and traditionally accepts routed multicast, so the default is `false`. Set `true` for single-segment deployments that want the stricter origin check. |

### Browser Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | `number` | `60000` | How often (ms) to search the network |
| `services` | `string \| string[]` | — | Service types to subscribe to |

### Advertiser Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | `number` | `60000` | How often (ms) to send notifications |
| `uuid` | `string` | auto (v4) | UUID for this device instance. Default is a fresh RFC 9562 v4 (random) UUID. UPnP DA expects device UUIDs to be stable across reboots; if you want that, generate one at install time, persist it, and pass it here. Avoid v1 (leaks MAC) and v7 (leaks creation timestamp via every USN multicast). |
| `services` | `Record<string, HeadersInit>` | — | Services to advertise with their headers |
| `authenticationProvider` | `(ip: string) => boolean \| Promise<boolean>` | `() => true` | Gates **unicast replies** to incoming `M-SEARCH` requests by remote IP. Returns `true` to allow the response, `false` to silently drop. Throws are treated as deny. Does **not** gate outbound multicast `NOTIFY`/`ssdp:byebye` traffic; see `silentMode`. |
| `silentMode` | `boolean` | `false` | When `true`, suppresses periodic multicast `NOTIFY ssdp:alive` and `ssdp:byebye` traffic entirely. The advertiser still answers unicast `M-SEARCH` requests that pass `authenticationProvider`. Use this when discoverability should be initiated by the requester rather than announced. |

## Security Considerations

- **SSDP has no authentication or integrity protection** at the protocol layer. Any host on the multicast scope can announce, withdraw, or impersonate any service. The `Browser` will surface those announcements to its `discover` and `withdraw` events. Consumers MUST validate any side effect (fetching a `LOCATION` URL, connecting to a service, trusting metadata) independently and treat SSDP discovery as a hint, not as a trust signal.
- **`authenticationProvider` only governs unicast `M-SEARCH` replies.** It does not affect periodic outbound `NOTIFY` or `ssdp:byebye` messages. If a deployment needs the device to remain silent on the wire and respond only to authorized direct queries, set `silentMode: true` in addition to providing an `authenticationProvider`.
- **The reply for an `M-SEARCH` is delayed by a random interval in `[0, MX]` seconds** to mitigate the multicast-amplification reply storm that occurs when many advertisers respond to a single discovery probe. The `MX` value is parsed from the incoming request and clamped to `[1, 5]` per UPnP DA.
- **Inbound parser hardening:** the SSDP layer strictly validates the start-line of incoming datagrams. Only `M-SEARCH * HTTP/1.1`, `NOTIFY * HTTP/1.1`, and `HTTP/1.1 <status> [<reason>]` are accepted; all other datagrams are silently dropped. Header lines with whitespace between the field name and colon are rejected per RFC 9112 §5.1.
- **Multicast TTL is fixed at 255** by the underlying `@gibme/multicast` layer per RFC 6762 §11 outbound hardening. The previous `ttl` option is no longer accepted.
- **UUID v7 is not used as the default** because the first 48 bits encode the device-creation millisecond timestamp, which is broadcast to every host on the multicast scope via the `USN` header of every advertisement. The default is UUID v4 (random); supply a stable UUID via the `uuid` option if you need cross-reboot identity stability.
- **Dropped packets are observable** via the `drop` event on both `SSDP` and `Browser` (currently only fires when `linkLocalOnly: true` and a packet's source IP failed the local-subnet check).

## License

MIT
