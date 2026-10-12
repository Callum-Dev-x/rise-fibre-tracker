/* The canvassing lists this app knows about.
   Each list lives in its own file and is only downloaded when it is picked, so
   opening the app never waits for a list nobody is using. The counts below are
   just for the tabs — they let the app show the size of a list before its data
   file has loaded. Add a list by generating it with tools/build-data.py and
   adding a line here. */

var RISE_LISTS = [];            // the data files push their payload in here

var RISE_LIST_INDEX = [
  {
    key: 'pe-ntn-cf',
    name: 'PE – NTN CF',
    file: 'js/data-pe-ntn-cf.js',
    where: 'Peterborough, Wisbech, Stamford & surrounding areas',
    addresses: 20525,
    streets: 517
  }
];
