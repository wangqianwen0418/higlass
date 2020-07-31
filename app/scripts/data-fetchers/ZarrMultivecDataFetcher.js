import slugid from 'slugid';
import { HTTPStore, openArray } from 'zarr';

class ZarrMultivecDataFetcher {
  constructor(dataConfig) {
    this.dataConfig = dataConfig;
    this.trackUid = slugid.nice();

    console.log(dataConfig);

    if (dataConfig.url) {
      console.assert(dataConfig.url.endsWith('.zarr'));

      // S3 bucket must have a CORS policy to allow reading from any origin.
      this.store = new HTTPStore(dataConfig.url);
    }
  }

  tilesetInfo(callback) {
    this.tilesetInfoLoading = true;

    // Use the tileset_info stored as JSON in file.zarr/.zattrs
    return this.store
      .getItem('.zattrs')
      .then(bytes => {
        const decoder = new TextDecoder('utf-8');
        const json = JSON.parse(decoder.decode(bytes));
        return json;
      })
      .then(attrs => {
        this.tilesetInfoLoading = false;
        const retVal = attrs;
        console.log(attrs);

        /*
            const TILE_SIZE = 1024;
            let retVal = {};
            // retVal[this.trackUid] = {
            retVal = {
            tile_size: TILE_SIZE,
            max_zoom: Math.ceil(
                Math.log(this.gbJson[0].size / TILE_SIZE) / Math.log(2)
            ),
            max_width: this.gbJson[0].size,
            min_pos: [0],
            max_pos: [this.gbJson[0].size]
            };
            */

        if (callback) {
          callback(retVal);
        }

        return retVal;
      })
      .catch(err => {
        this.tilesetInfoLoading = false;

        if (callback) {
          callback({
            error: `Error parsing zarr multivec: ${err}`,
          });
        }
      });
  }

  fetchTilesDebounced(receivedTiles, tileIds) {
    const tiles = {};

    const validTileIds = [];
    const tilePromises = [];

    for (const tileId of tileIds) {
      const parts = tileId.split('.');
      const z = parseInt(parts[0], 10);
      const x = parseInt(parts[1], 10);

      if (Number.isNaN(x) || Number.isNaN(z)) {
        console.warn('Invalid tile zoom or position:', z, x);
        continue;
      }

      validTileIds.push(tileId);
      tilePromises.push(this.tile(z, x));
    }

    Promise.all(tilePromises).then(values => {
      for (let i = 0; i < values.length; i++) {
        const validTileId = validTileIds[i];
        tiles[validTileId] = values[i];
        tiles[validTileId].tilePositionId = validTileId;
      }

      receivedTiles(tiles);
    });
    // tiles = tileResponseToData(tiles, null, tileIds);
    return tiles;
  }

  tile(z, x) {
    return this.tilesetInfo().then(tsInfo => {
      const tileWidth = +tsInfo.max_width / 2 ** +z;

      // get the bounds of the tile
      const minX = tsInfo.min_pos[0] + x * tileWidth;
      const maxX = tsInfo.min_pos[0] + (x + 1) * tileWidth;

      const scaleFactor = 1024 / 2 ** (tsInfo.max_zoom - z);

      return [];
    });
  }
}

export default ZarrMultivecDataFetcher;
