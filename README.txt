NACOSS ATTENDANCE MANAGEMENT SYSTEM - v3 (Online + Offline + Installable)

LOGIN (default)   Username: NACOSS   Password: ncoss123
(Change the password in Settings > Change Password.)

1. PUT THE APP ONLINE (needed for install + offline mode; must be https)
   Open https://app.netlify.com/drop and drag this whole folder onto it.
   Open the link in Chrome -> "Install NACOSS Attendance".
   (Opening index.html straight from the phone's files cannot install or work offline.)

2. DATABASE
   Already connected in config.js. Run supabase_setup.sql once in
   Supabase -> SQL Editor.

MOVING OLD DATA
   Old app: Settings > Backup Database. New app: Settings > Backup Database > Restore.

SECURITY NOTE
   One shared admin login and the key is inside the app, so do not share the link publicly.
