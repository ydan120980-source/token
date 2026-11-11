'use strict';
// Manual future build only. Without an explicitly supplied public publisher
// identity this fails before electron-builder can discover any signing identity.
// Invoke with --publish never. A config is not a wired or accepted auto-updater.
module.exports=require('./signing-profile').configuration({publisher:process.env.AGENT_USAGE_SIGNING_PUBLISHER,feedUrl:process.env.AGENT_USAGE_UPDATE_FEED});
