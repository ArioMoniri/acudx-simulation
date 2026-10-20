# Keycloak dev realm for AcuDx

`realm-acudx.json` is imported by `docker-compose.keycloak.yml` on first start.
It is a DEVELOPMENT realm: every password below is a throwaway and must never
be reused outside a local machine.

| Username | Password | Realm role | org attribute |
|---|---|---|---|
| student.dev | student-dev-only | student | acudx-dev-med |
| resident.dev | resident-dev-only | resident (includes student) | acudx-dev-med |
| nurse.dev | nurse-dev-only | nurse | acudx-dev-med |
| paramedic.dev | paramedic-dev-only | paramedic | acudx-dev-med |
| faculty.dev | faculty-dev-only | faculty (includes resident) | acudx-dev-med |
| dean.dev | dean-dev-only | dean (includes faculty) | acudx-dev-med |
| admin.dev | admin-dev-only | admin (includes dean) | acudx-dev-med |
| superadmin.dev | superadmin-dev-only | super_admin (includes admin) | acudx-platform |

Keycloak admin console: http://localhost:8080 with `KC_ADMIN` / `KC_ADMIN_PASSWORD`
(defaults `admin` / `change-me-dev-only`).

## Start

```bash
docker compose -f docker-compose.yml -f docker-compose.keycloak.yml up -d keycloak
# register the realm as the identity provider (bootstrap admin token):
curl -X POST http://localhost:8890/admin/providers -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"kind":"identity","name":"keycloak-dev","base_url":"http://localhost:8080/realms/acudx",
       "extra":{"client_id":"acudx-web","flavor":"keycloak","role_claim_path":"realm_access.roles","org_claim_path":"org"}}'
# optional: require verified identity on every protected route
curl -X PUT http://localhost:8890/admin/settings -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"settings":{"auth_mode":"oidc"}}'
```

The web app (`npm --prefix web run dev`, http://localhost:5173) then shows
"Sign in with your institution" on the sign-in screen. The client is public and
uses PKCE (S256); the realm adds an `aud: acudx-web` audience mapper so the
server can verify the audience, and a client scope `acudx-org` that maps the
user attribute `org` onto the `org` claim (the AcuDx tenant).

## Mapping a university IdP (SAML) into this realm

Keycloak brokers university identity: AcuDx keeps verifying ONE issuer (the
realm) while each school signs in through its own IdP.

1. Realm `acudx` -> Identity providers -> Add provider -> SAML v2.0. Paste the
   university's IdP metadata URL (Shibboleth / ADFS / Azure AD / Okta all publish
   one) and let Keycloak import the endpoints and signing certificate. Set
   NameID policy to `persistent` and request signed assertions.
2. Export the realm's SP metadata from the same screen (the "SAML 2.0 Service
   Provider Metadata" link) and send it to the university's federation contact.
   For eduGAIN members publish it through the national federation and request
   the REFEDS R&S / Personalized entity category so `eduPersonPrincipalName`,
   `mail`, `displayName` and `eduPersonAffiliation` are released.
3. Mappers on the identity provider:
   - `eduPersonAffiliation` (urn:oid:1.3.6.1.4.1.5923.1.1.1.1) -> "Advanced
     Attribute to Role" mapper: `student` -> realm role `student`,
     `faculty` -> `faculty`, `staff` -> `faculty`, `employee` -> no role.
   - `schacHomeOrganization` (urn:oid:1.3.6.1.4.1.25178.1.2.9) -> "Attribute
     Importer" into the user attribute `org`, so the `acudx-org` scope turns it
     into the tenant claim.
   - `mail` -> `email`, `displayName` -> `firstName`/`lastName`.
4. First login flow: keep `first broker login` with "Review profile" off so the
   person lands straight in AcuDx; link duplicate emails only if the university
   guarantees unique `mail`.
5. Routing: with Keycloak Organizations (26.8+) create one Organization per
   school, attach the SAML IdP to it and add its verified email domains, so
   Keycloak sends `name@uni.edu` straight to that IdP. Without Organizations,
   pass `kc_idp_hint=<alias>` from the web app
   (`beginSignIn(cfg, { extra: { kc_idp_hint: "uni-saml" } })`).
6. Promote deans and admins in the AcuDx admin console (Admin -> Users) by
   their Keycloak `sub`; granted roles are unioned with the claim roles, so no
   change to the university IdP is needed for staff roles.

Stock Keycloak does not ingest federation metadata aggregates: onboard partner
schools one by one (fine for the first 5 to 20), or front Keycloak with a
SATOSA/pyFF or Shibboleth SP proxy when federation-wide discovery is required.

## LTI 1.3 (next step)

LTI 1.3 is itself OIDC-based, so the university IdP stays in the identity layer
and the LTI tool only validates launches and posts grades.

- Run a small Node service with `ltijs` (Apache-2.0) next to the gateway:
  registers the AcuDx tool with the LMS (Moodle, Canvas, Blackboard), handles
  the OIDC login initiation + launch JWT validation, Deep Linking (pick a case
  from inside the LMS) and the Assignment and Grade Services (AGS) grade
  passback.
- On a valid launch the service mints a short-lived AcuDx session by calling
  the gateway with the LTI claims (`sub`, `https://purl.imsglobal.org/spec/lti/claim/roles`
  mapped onto student / faculty, the deployment id as `org`), using the same
  `user_roles` directory for staff promotions.
- Grade passback reads the encounter summary the web app already posts to
  `POST /v1/events/encounter` (server/learning) and writes the AGS score for
  the launching line item.
- Pure-Python alternative: fork `pylti1p3` into `server/lti/` (maintenance has
  stalled upstream), keeping the gateway single-language.
