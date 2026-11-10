// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The library under test lives in the parent folder and has its own node_modules for
// development. Resolve every package from the example only, so the library's source and the
// app share one copy of react, react-native and the native camera modules.
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.resolve(__dirname, './node_modules')];

config.resolver.extraNodeModules = {
  'cattus-study-verify': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

// The models are bundled with require('….tflite').
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite'];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
