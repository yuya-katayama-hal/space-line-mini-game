Ultimate goal is tell visitors "how the earth is worthy to us".

There are two things to make
* pre-registration system
  visitors can do registrations, pre, or on-time
  pre registered visitors can come back to the booth later
* actual experience booth
  visitors sit on the chair, use hand-gestures to make rocket launch, select a destination, then come back to the earth

## Decisions (2026-10-23)
* Backstory: the visitor is already in 2126. No time travel: Earth, space, the Moon and Mars are all 2126
* Destinations: the Moon and Mars; more may be added later, so destinations should be easy to add
* 1926 and the Earth 2126 city are dropped (no backup kept)
* Registration: visitors scan a QR code and register on their own phones, either before the event or on the day
* The booth PC is online at the venue, so it reads registrations from the server directly
* Visitors give a nickname only, no personal data
* Host: Firebase (database + hosting) for now; the database can be swapped later (docs/queue-backends.md)
* Environments: `product` (default, Firebase) and `dev` (local server), fixed when the pages are built (npm run build / build:dev, defined in shared/queue/config.ts), never from a URL
* Folders split by where they run: `hosting/` is the only thing published to Firebase; `reception/` and `server/` stay on the reception PC
* Firebase account: prepared by the project owner; project `space-line-54818` is live
* Cancelling: both the visitor (own ticket, before their turn) and staff can cancel; status `cancelled`, counted apart from no-shows
* Proof of arrival: NFC check-in with NTAG 424 DNA (copy-proof tags), checked on the reception PC (keys never leave it;
  Firebase stays on the free plan). A tap is accepted only from the phone that registered and only if its counter is
  higher than the last accepted one. Used for records / stats and to stop impersonation (the booth binds a called
  visitor's turn only after check-in). Details: docs/nfc-checkin.md

## Still open
* Who runs the operator screen (call next / done / no-show) on site
* How long one turn takes (under discussion); it sets the queue's waiting-time estimates
