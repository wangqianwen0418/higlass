import { configure } from 'enzyme';

import Adapter from 'enzyme-adapter-react-16';

import {
  mountHGComponent,
  removeHGComponent,
  waitForJsonComplete,
} from '../../app/scripts/utils';

import { onlyGPSB } from '../view-configs';

configure({ adapter: new Adapter() });

// import FetchMockHelper from '../utils/FetchMockHelper';

describe('Exising genome position search box', () => {
  let hgc = null;
  let div = null;
  // const fetchMockHelper = new FetchMockHelper(null, 'higlass.io');

  beforeAll(async (done) => {
    // await fetchMockHelper.activateFetchMock();
    [div, hgc] = mountHGComponent(div, hgc, onlyGPSB, done, {
      style: 'width:800px; height:400px; background-color: lightgreen',
      bounded: true,
    });
    // visual check that the heatmap track config menu is moved
    // to the left
  });

  afterAll(async () => {
    removeHGComponent(div);
    // await fetchMockHelper.storeDataAndResetFetchMock();
  });

  it('Makes the search box invisible', (done) => {
    hgc.instance().handleTogglePositionSearchBox('aa');

    waitForJsonComplete(done);
  });

  it('Makes the search box visible again', (done) => {
    hgc.instance().handleTogglePositionSearchBox('aa');

    waitForJsonComplete(done);
  });

  it('Searches for strings with spaces at the beginning', () => {
    const gpsb = hgc.instance().genomePositionSearchBoxes.aa;

    let [range1, range2] = gpsb.searchField.searchPosition(
      '  chr1:1-1000 & chr1:2001-3000',
    );

    expect(range1[0]).toEqual(1);
    expect(range1[1]).toEqual(1000);

    expect(range2[0]).toEqual(2001);
    expect(range2[1]).toEqual(3000);

    [range1, range2] = gpsb.searchField.searchPosition(
      'chr1:1-1000 & chr1:2001-3000',
    );

    expect(range1[0]).toEqual(1);
    expect(range1[1]).toEqual(1000);
  });

  it('Ensures that hg38 is in the list of available assemblies', () => {
    expect(
      hgc
        .instance()
        .genomePositionSearchBoxes.aa.state.availableAssemblies.indexOf('hg38'),
    ).toBeGreaterThanOrEqual(0);
  });

  it('Selects mm9', (done) => {
    hgc.instance().genomePositionSearchBoxes.aa.handleAssemblySelect('mm9');

    waitForJsonComplete(done);
  });

  it('Checks that mm9 was properly set and switches back to hg19', (done) => {
    hgc.update();
    const button = hgc.instance().genomePositionSearchBoxes.aa
      .assemblyPickButton;

    expect(button.title).toEqual('mm9');

    hgc.instance().genomePositionSearchBoxes.aa.handleAssemblySelect('hg19');

    waitForJsonComplete(done);
  });

  it('Checks that hg19 was properly', (done) => {
    hgc.update();
    const button = hgc.instance().genomePositionSearchBoxes.aa
      .assemblyPickButton;

    expect(button.title).toEqual('hg19');

    waitForJsonComplete(done);
  });
});
