# SSDP Library

This package is designed to be a lightweight SSDP implementation.

## Documentation

[https://gibme-npm.github.io/ssdp](https://gibme-npm.github.io/ssdp)

## Features

* Advertiser implementation
  * Auto-handles M-SEARCH requests:
    * upnp::rootdevice
    * uuid:<uuid>
    * ssdp::all
  * Dynamic service announcement and withdrawal
* Browser implementation
  * Dynamic service subscription and unsubscription

## Sample Code

### Browser

```typescript
import { Browser} from '@gibme/ssdp';

(async () => {
    const browser = await Browser.create({
        interval: 5000,
        services: ['urn:schemas-upnp-org:device:MediaServer:1']
    });
    
    browser.on('discover', (service, payload, remote, local) => {
        console.log({
            service,
            payload,
            remote,
            local
        });
    });
    
    browser.on('withdraw', (service, payload, remote, local) => {
        console.log({
            service,
            payload,
            remote,
            local
        });
    });
    
    browser.searchNow();
})();
```

### Advertiser

```typescript
import { Advertiser } from '@gibme/ssdp';

(async () => {
    const advertiser = await Advertiser.create({
        interval: 5000,
        services: ['urn:schemas-upnp-org:device:MediaServer:1']
    });

    advertiser.announceNow();
});
```
