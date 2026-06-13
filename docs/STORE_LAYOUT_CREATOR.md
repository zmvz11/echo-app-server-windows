# Echo Store Layout Creator

Echo Release QA v10 adds a Store Layout Creator for admins.

The layout creator lets admins build the Store homepage from draggable sections:

- Hero Feature
- Horizontal App Row
- App Grid
- Category Row
- Category Tabs
- Promo Banner
- Spacer

The primary layout is stored server-side at `/api/store/layout`. Admins publish updates through `/api/store/admin/layout`.

Store layouts are intentionally server-owned so every Echo App Center client receives the same Store homepage after refresh.
