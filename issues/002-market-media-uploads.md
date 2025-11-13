# Media Upload Support

## Summary
- Capture an optional image URL when moderators create markets.
- Surface market artwork across list and detail views with a fallback icon.
- Prepare groundwork for eventual Devvit CDN integration, allowing extensionless URLs that Devvit can proxy.

## Tasks
- [x] Extend market schemas and serialization to persist an `imageUrl` field.
- [x] Update create-market APIs and validation to accept an optional, sanitized image URL.
- [x] Add image URL input to the moderator create form with client-side validation feedback.
- [x] Render market imagery on list and detail screens, falling back to the default icon when absent.
- [ ] Document follow-up for uploading assets to the Devvit CDN once external staging is available.
