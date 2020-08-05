import slugid from 'slugid';
import { HTTPStore, openArray, slice } from 'zarr';
import { absToChr } from '../utils';
import { parseChromsizesRows } from '../ChromosomeInfo';

import DenseDataExtrema1D from '../utils/DenseDataExtrema1D';
import { minNonZero, maxNonZero } from '../worker';
/**
 *
 * @param {number[]} chromSizes An array of the lengths of the chromosomes [1000,...]
 * @param {number} startPos The starting genomic position
 * @param {number} endPos The ending genomic position
 */
function abs2genomic(chromSizes, absStartPos, absEndPos) {
  const chromInfo = parseChromsizesRows(chromSizes);
  const [chrStart, chrStartPos] = absToChr(absStartPos, chromInfo);
  const [chrEnd, chrEndPos] = absToChr(absEndPos, chromInfo);
  return [
    { chr: chrStart, pos: chrStartPos },
    { chr: chrEnd, pos: chrEndPos },
  ];
}

class ZarrMultivecDataFetcher {
  constructor(dataConfig) {
    this.dataConfig = dataConfig;
    this.trackUid = slugid.nice();

    //console.log(dataConfig);

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

        const max_pos_0 = attrs.max_pos[0];
        const tile_size = attrs.tile_size;
        const retVal = {
          ...attrs,
          max_width: max_pos_0,
          max_zoom: Math.ceil(Math.log(max_pos_0 / tile_size) / Math.log(2)),
        };

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
      tilePromises.push(this.tile(z, x, tileId));
    }

    Promise.all(tilePromises).then(values => {
      for (let i = 0; i < values.length; i++) {
        const validTileId = validTileIds[i];
        tiles[validTileId] = values[i];
        tiles[validTileId].tilePositionId = validTileId;
      }

      //console.log(tiles);

      receivedTiles(tiles);
    });
    // tiles = tileResponseToData(tiles, null, tileIds);
    return tiles;
  }

  tile(z, x, tileId) {
    const { store } = this;
    console.log(`tile z: ${z}, x: ${x}`);
    return this.tilesetInfo().then(tsInfo => {
      // Adapted from clodius.tiles.multivec.get_single_tile
      // Reference: https://github.com/higlass/clodius/blob/develop/clodius/tiles/multivec.py#L66

      // z is the index of the resolution that should be selected.
      // Resolution is size of each bin (except for the last bin in each chromosome).
      const resolution = tsInfo.resolutions[z];
      const tileSize = tsInfo.tile_size;

      // Where in the data does the tile start and end?
      const tileStart = x * tileSize * resolution;
      const tileEnd = tileStart + tileSize * resolution;

      // chromSizes is an array of "tuples" [ ["chr1", 1000], ... ]
      const chromSizes = tsInfo.chromSizes;

      // Adapted from clodius.tiles.multivec.get_tile
      // Reference: https://github.com/higlass/clodius/blob/develop/clodius/tiles/multivec.py#L110

      const binSize = resolution;

      const [genomicStart, genomicEnd] = abs2genomic(
        chromSizes,
        tileStart,
        tileEnd,
      );
      const { chr: chrStart, pos: chrStartPos } = genomicStart;
      const { chr: chrEnd, pos: chrEndPos } = genomicEnd;

      if(chrStart === chrEnd) {
        const zStart = Math.floor(chrStartPos / binSize);
        const zEnd = Math.ceil(chrEndPos / binSize);

        const arr = openArray({ store, path: `/resolutions/${resolution}/values/${chrStart}/`, mode: 'r' })
        return arr.then(zData => {
          return zData.getRaw([slice(zStart, zStart + tileSize), null])
            .then((dataSliceWrapper) => {
              const dataSlice = dataSliceWrapper.data;
              const shape = dataSliceWrapper.shape;
              console.log(zStart, zEnd, dataSliceWrapper);
              return Promise.resolve({
                dense: dataSlice,
                denseDataExtrema: new DenseDataExtrema1D(dataSlice),
                dtype: 'float32',
                
                min_value: Math.min.apply(null, dataSlice),
                max_value: Math.max.apply(null, dataSlice),
                minNonZero: minNonZero(dataSlice),
                maxNonZero: maxNonZero(dataSlice),
                server: null,
                size: 1,
                shape: [shape[1], shape[0]],
                tileId: tileId,
                tilePos: [x],
                tilePositionId: tileId,
                tilesetUid: null,
                zoomLevel: z,
              });
            })
        });
      } else {
        console.log(binSize, genomicStart, genomicEnd);
      }


      /*
        const tileWidth = +tsInfo.max_width / 2 ** +z;

        // get the bounds of the tile
        const minX = tsInfo.min_pos[0] + x * tileWidth;
        const maxX = tsInfo.min_pos[0] + (x + 1) * tileWidth;

        const scaleFactor = 1024 / 2 ** (tsInfo.max_zoom - z);
        */

      return Promise.resolve({
        dense: [],
        denseDataExtrema: new DenseDataExtrema1D([]),
        dtype: 'float32',
        
        min_value: Math.min.apply(null, []),
        max_value: Math.max.apply(null, []),
        minNonZero: minNonZero([]),
        maxNonZero: maxNonZero([]),
        server: null,
        size: 1,
        shape: [0, 0],
        tileId: tileId,
        tilePos: [x],
        tilePositionId: tileId,
        tilesetUid: null,
        zoomLevel: z,
      });
    });
  }
}

export default ZarrMultivecDataFetcher;
