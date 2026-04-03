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
| `ttl` | `number` | `2` | Multicast TTL (time-to-live) |

### Browser Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | `number` | `60000` | How often (ms) to search the network |
| `services` | `string \| string[]` | — | Service types to subscribe to |

### Advertiser Options

| Option | Type | Default | Description |
|---|---|---|---|
| `interval` | `number` | `60000` | How often (ms) to send notifications |
| `uuid` | `string` | auto (v7) | UUID for this device instance |
| `services` | `Record<string, HeadersInit>` | — | Services to advertise with their headers |
| `authenticationProvider` | `(ip: string) => boolean \| Promise<boolean>` | `() => true` | Controls which hosts receive responses |

## License

MIT
