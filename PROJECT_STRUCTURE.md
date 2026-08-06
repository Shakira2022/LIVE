# Project Structure

```text
app/
  page.tsx                         Public landing page
  login/ register/ forgot-password/
  app/
    requester/                     Request creation, tracking, history and profile
    dispatcher/                    Live operations, queue, resources and activity
    responder/                     Mission, history and profile
    admin/                         Users, organisations, audit and settings
    auditor/                       Read-only incident and audit review
components/
  auth/                            Session and demo-account components
  dashboard/                       Shared operational metrics
  layout/                          Brand, public header, app shell and account sheet
  maps/                            Responsive mock live map
  requests/                        Shared request rows and status timeline
  ui/                              Buttons, fields, sheets, panels and skeletons
lib/
  mock-data.ts                     Demo accounts and operational seed data
  mock-store.tsx                   Functional browser-local workflow actions
  routes.ts                        Role-specific desktop and mobile navigation
  types.ts                         Shared TypeScript models
  utils.ts                         Formatting, routing and status helpers
supabase/
  schema.sql                       Production-oriented database starting point
```

The route files remain small because the navigation, sheets, map, request rows, timelines and visual primitives are reusable components.
