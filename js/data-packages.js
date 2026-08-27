/* RISE Fibre package data — transcribed from the official pricing screens.
   All prices are for the 24 month contract, the only term supplied.
   Every tier starts with a 6 month intro discount, then steps up to the full
   price and rises again each March, exactly as printed on the package cards. */

const RISE_PACKAGES = [
  {
    id: 'g1',
    speed: '1 Gbps',
    speedMbps: 1000,
    flagship: true,
    badge: 'Best Value',            // shown as "Most Popular" on its own card
    badgeAlt: 'Most Popular',
    price: 5.00,                    // what they pay for the first 6 months
    discount: 18.50,
    discountText: 'Includes £18.50 discount for first 6 months.',
    blurb: 'Ideal for Ultra HD video streaming, gaming and high usage home-based work',
    increases: [
      { price: 23.50, from: 'February 2027' },
      { price: 27.50, from: 'March 2027' },
      { price: 31.50, from: 'March 2028' }
    ],
    features: [
      'Free activation',
      'Unlimited data usage',
      '1000Mbps download',
      '1000Mbps upload',
      '24 months minimum term'
    ]
  },
  {
    id: 'g23',
    speed: '2.3 Gbps',
    speedMbps: 2300,
    flagship: true,
    badge: 'Fastest',
    price: 5.00,
    discount: 28.50,
    discountText: 'Includes £28.50 discount for first 6 months.',
    blurb: 'Perfect for households with multiple users streaming, gaming and working online all at once',
    increases: [
      { price: 33.50, from: 'February 2027' },
      { price: 37.50, from: 'March 2027' },
      { price: 41.50, from: 'March 2028' }
    ],
    /* The 2.3 Gbps feature list was not in the supplied screens. The first two
       and the last are identical on every other tier; the speeds follow the
       symmetric download/upload pattern of all four tiers below. Check these
       against the official card before quoting them. */
    features: [
      'Free activation',
      'Unlimited data usage',
      '2300Mbps download',
      '2300Mbps upload',
      '24 months minimum term'
    ]
  },
  {
    id: 'm500',
    speed: '500 Mbps',
    speedMbps: 500,
    flagship: false,
    badge: null,
    price: 15.00,
    discount: 10.00,
    discountText: 'Includes £10.00 discount for first 6 months.',
    blurb: 'Ideal for HD video streaming, gaming and cloud-based work',
    increases: [
      { price: 25.00, from: 'February 2027' },
      { price: 29.00, from: 'March 2027' },
      { price: 33.00, from: 'March 2028' }
    ],
    features: [
      'Free activation',
      'Unlimited data usage',
      '500Mbps download',
      '500Mbps upload',
      '24 months minimum term'
    ]
  },
  {
    id: 'm250',
    speed: '250 Mbps',
    speedMbps: 250,
    flagship: false,
    badge: null,
    price: 14.50,
    discount: 10.00,
    discountText: 'Includes £10.00 discount for first 6 months.',
    blurb: 'Great for multi-person, multi-device households',
    increases: [
      { price: 24.50, from: 'February 2027' },
      { price: 28.50, from: 'March 2027' },
      { price: 32.50, from: 'March 2028' }
    ],
    features: [
      'Free activation',
      'Unlimited data usage',
      '250Mbps download',
      '250Mbps upload',
      '24 months minimum term'
    ]
  },
  {
    id: 'm150',
    speed: '150 Mbps',
    speedMbps: 150,
    flagship: false,
    badge: null,
    price: 13.50,
    discount: 10.00,
    discountText: 'Includes £10.00 discount for first 6 months.',
    blurb: 'Perfect for everyday use, students and home-schooling',
    increases: [
      { price: 23.50, from: 'February 2027' },
      { price: 27.50, from: 'March 2027' },
      { price: 31.50, from: 'March 2028' }
    ],
    features: [
      'Free activation',
      'Unlimited data usage',
      '150Mbps download',
      '150Mbps upload',
      '24 months minimum term'
    ]
  }
];

/* Every price on every card is the first-6-months price. */
const RISE_PRICE_NOTE = 'for the first 6 months';

/* Contract term shown on every card. Only the 24 month prices were supplied. */
const RISE_TERM = '24 month contract';

/* Which packages are available where.
   The canvassing spreadsheet carries no per-address availability column, so
   availability is matched on postcode, as instructed. Every postcode in the
   supplied list is RH13 (full fibre area), so all five packages are offered.
   To restrict a postcode later, add an entry: 'RH13 5AW': ['g1','m150'] */
const RISE_AVAILABILITY = {
  default: ['g1', 'g23', 'm500', 'm250', 'm150'],
  byOutcode: { RH13: ['g1', 'g23', 'm500', 'm250', 'm150'] },
  byPostcode: {}
};

/* Packages available at one address, flagship tiers first. */
function packagesFor(postcode) {
  const pc = (postcode || '').toUpperCase().trim();
  const outcode = pc.split(' ')[0];
  const ids = RISE_AVAILABILITY.byPostcode[pc]
    || RISE_AVAILABILITY.byOutcode[outcode]
    || RISE_AVAILABILITY.default;
  return RISE_PACKAGES.filter(p => ids.indexOf(p.id) !== -1);
}
