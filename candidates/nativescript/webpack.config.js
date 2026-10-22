const webpack = require('@nativescript/webpack');

module.exports = (env) => {
  webpack.init(env);

  // The replay stream (app/generated/stream, written by scripts/prepare-assets.mjs) is read from the app
  // folder on iOS. Android reads it from APK assets (App_Resources/Android/src/main/assets/mobilebench), outside
  // the app folder that the runtime extracts on the first launch, so it is not copied there.
  if (webpack.Utils.platform.getPlatformName() === 'ios') {
    webpack.Utils.addCopyRule('generated/stream/**');
  }

  return webpack.resolveConfig();
};
