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

      const multiscales = tsInfo.multiscales;

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
      console.log(binSize, genomicStart, genomicEnd);

      // Using the [genomicStart, genomicEnd] range, get an array of "chromosome chunks",
      // where each chunk range starts and ends with the same chromosome.
      // Start a new chromosome chunk at each chromosome boundary.
      const chrChunks = [];
      if(chrStart === chrEnd) {
        // This tile does _not_ cross a chromosome boundary.
        const chrName = chrStart;
        const zStart = Math.floor(chrStartPos / binSize);
        const zEnd = Math.min(zStart + 256, Math.ceil(chrEndPos / binSize));

        chrChunks.push([ chrName, zStart, zEnd ]);
      } else {
        // This tile does cross a chromosome boundary.
        let zRemaining = 256;
        const chrStartIndex = chromSizes.findIndex(([chrName]) => chrName === chrStart);
        const chrEndIndex = chromSizes.findIndex(([chrName]) => chrName === chrEnd);

        for(let chrIndex = chrStartIndex; chrIndex <= chrEndIndex; chrIndex++) {
          let chrChunkStart;
          let chrChunkEnd;

          const [currChrName, currChrLen] = chromSizes[chrIndex];

          if(chrIndex < chrEndIndex) {
            // If the current chromosome is before the end chromosome, then we want the chunk to end at the end of the current chromosome.
            if(chrIndex === chrStartIndex) {
              // If this is the start chromosome, we may want to start at somewhere past 0.
              chrChunkStart = chrStartPos;
            } else {
              // If this is not the start chromosome, then it is somewhere in the middle, and we want to start at 0.
              chrChunkStart = 0;
            }
            chrChunkEnd = currChrLen;
          } else {
            // The current chromosome is the end chromosome, so we may want the chunk to end before the end of the chromosome.
            chrChunkStart = 0;
            chrChunkEnd = chrEndPos;
          }

          const zStart = Math.floor(chrChunkStart / binSize);
          const zEnd = Math.min(zStart + zRemaining, Math.ceil(chrChunkEnd / binSize));
          chrChunks.push([ currChrName, zStart, zEnd ]);
          zRemaining -= (zEnd - zStart);
        }
      }

      console.log(chrChunks);
      // Get the zarr data for each chromosome chunk,
      // since data for each chromosome is stored in a separate zarr array.
      // Fill in `fullTileArray` appropriately.
      return Promise.all(chrChunks.map(([chrName, zStart, zEnd]) => {
        console.log(chrName, zStart, zEnd);
        return openArray({ store, path: `/chromosomes/${chrName}/${resolution}/`, mode: 'r' })
          .then((arr) => arr.get([null, slice(zStart, zEnd)]));
      }))
        .then((chunks) => {
          console.log(chunks);
          // Allocate a Float32Array for the tile (with length num_samples * tile_size).
          const fullTileLength = tsInfo.shape[0] * tsInfo.shape[1];
          const fullTileArray = new Float32Array(fullTileLength);

          // Fill in the data for each sample.
          let offset = 0;
          const numSamples = tsInfo.shape[1];
          for(let sampleI = 0; sampleI < numSamples; sampleI++) {
            for(let chunk of chunks) {
              const chunkData = chunk.data[sampleI];
              fullTileArray.set(chunkData, offset);
              offset += chunkData.length;
            }
          }

          return Promise.resolve({
            dense: fullTileArray,
            denseDataExtrema: new DenseDataExtrema1D(fullTileArray),
            dtype: 'float32',
            min_value: Math.min.apply(null, fullTileArray),
            max_value: Math.max.apply(null, fullTileArray),
            minNonZero: minNonZero(fullTileArray),
            maxNonZero: maxNonZero(fullTileArray),
            server: null,
            size: 1,
            shape: tsInfo.shape,
            tileId: tileId,
            tilePos: [x],
            tilePositionId: tileId,
            tilesetUid: null,
            zoomLevel: z,
          });

        });
      });
  }
}

export default ZarrMultivecDataFetcher;
