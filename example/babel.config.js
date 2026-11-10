module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo adds the react-native-worklets Babel plugin by itself when the
    // package is installed. That plugin turns the 'worklet' functions of the library into
    // code that can run on the camera thread. An app without babel-preset-expo adds
    // 'react-native-worklets/plugin' as the last plugin.
    presets: ['babel-preset-expo'],
  };
};
