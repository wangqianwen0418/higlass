import GBKDataFetcher from './genbank-fetcher';
import ZarrMultivecDataFetcher from './ZarrMultivecDataFetcher';
import LocalDataFetcher from './local-tile-fetcher';
import DataFetcher from '../DataFetcher';

const getDataFetcher = (dataConfig, pubSub) => {
  if (dataConfig.type === 'genbank') {
    return new GBKDataFetcher(dataConfig, pubSub);
  }

  if (dataConfig.type === 'local-tiles') {
    return new LocalDataFetcher(dataConfig, pubSub);
  }

  if (dataConfig.type === 'zarr-multivec') {
    return new ZarrMultivecDataFetcher(dataConfig, pubSub);
  }

  return new DataFetcher(dataConfig, pubSub);
};

export default getDataFetcher;
