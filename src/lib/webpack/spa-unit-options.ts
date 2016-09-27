import spaOptions from './spa-options';
import {
  entryUnit,
  outputTest,
  devtoolTest,
  WsWebpackConfiguration
} from './generic';

const options: WsWebpackConfiguration = Object.assign({}, spaOptions, {
  entry: entryUnit,
  output: outputTest,
  devtool: devtoolTest
});

export default options;
