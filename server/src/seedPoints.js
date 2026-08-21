// Seed points for real Street View rounds: approximate city centers in
// countries/regions with solid Google Street View coverage. A round picks
// one at random, jitters it a bit, then asks Google's Street View metadata
// API to snap to the nearest real panorama within `jitterRadiusKm`.
export const SEED_POINTS = [
  // North America
  { city: "New York", country: "United States", lat: 40.7128, lng: -74.006 },
  { city: "Los Angeles", country: "United States", lat: 34.0522, lng: -118.2437 },
  { city: "Chicago", country: "United States", lat: 41.8781, lng: -87.6298 },
  { city: "San Francisco", country: "United States", lat: 37.7749, lng: -122.4194 },
  { city: "Miami", country: "United States", lat: 25.7617, lng: -80.1918 },
  { city: "Seattle", country: "United States", lat: 47.6062, lng: -122.3321 },
  { city: "Denver", country: "United States", lat: 39.7392, lng: -104.9903 },
  { city: "Austin", country: "United States", lat: 30.2672, lng: -97.7431 },
  { city: "Boston", country: "United States", lat: 42.3601, lng: -71.0589 },
  { city: "New Orleans", country: "United States", lat: 29.9511, lng: -90.0715 },
  { city: "Las Vegas", country: "United States", lat: 36.1699, lng: -115.1398 },
  { city: "Phoenix", country: "United States", lat: 33.4484, lng: -112.074 },
  { city: "Toronto", country: "Canada", lat: 43.6532, lng: -79.3832 },
  { city: "Vancouver", country: "Canada", lat: 49.2827, lng: -123.1207 },
  { city: "Montreal", country: "Canada", lat: 45.5017, lng: -73.5673 },
  { city: "Calgary", country: "Canada", lat: 51.0447, lng: -114.0719 },
  { city: "Mexico City", country: "Mexico", lat: 19.4326, lng: -99.1332 },
  { city: "Guadalajara", country: "Mexico", lat: 20.6597, lng: -103.3496 },

  // South America
  { city: "Sao Paulo", country: "Brazil", lat: -23.5505, lng: -46.6333 },
  { city: "Rio de Janeiro", country: "Brazil", lat: -22.9068, lng: -43.1729 },
  { city: "Buenos Aires", country: "Argentina", lat: -34.6037, lng: -58.3816 },
  { city: "Santiago", country: "Chile", lat: -33.4489, lng: -70.6693 },
  { city: "Bogota", country: "Colombia", lat: 4.711, lng: -74.0721 },
  { city: "Lima", country: "Peru", lat: -12.0464, lng: -77.0428 },
  { city: "Montevideo", country: "Uruguay", lat: -34.9011, lng: -56.1645 },

  // Western Europe
  { city: "London", country: "United Kingdom", lat: 51.5074, lng: -0.1278 },
  { city: "Manchester", country: "United Kingdom", lat: 53.4808, lng: -2.2426 },
  { city: "Edinburgh", country: "United Kingdom", lat: 55.9533, lng: -3.1883 },
  { city: "Dublin", country: "Ireland", lat: 53.3498, lng: -6.2603 },
  { city: "Paris", country: "France", lat: 48.8566, lng: 2.3522 },
  { city: "Lyon", country: "France", lat: 45.764, lng: 4.8357 },
  { city: "Marseille", country: "France", lat: 43.2965, lng: 5.3698 },
  { city: "Berlin", country: "Germany", lat: 52.52, lng: 13.405 },
  { city: "Munich", country: "Germany", lat: 48.1351, lng: 11.582 },
  { city: "Hamburg", country: "Germany", lat: 53.5511, lng: 9.9937 },
  { city: "Amsterdam", country: "Netherlands", lat: 52.3676, lng: 4.9041 },
  { city: "Rotterdam", country: "Netherlands", lat: 51.9244, lng: 4.4777 },
  { city: "Brussels", country: "Belgium", lat: 50.8503, lng: 4.3517 },
  { city: "Zurich", country: "Switzerland", lat: 47.3769, lng: 8.5417 },
  { city: "Geneva", country: "Switzerland", lat: 46.2044, lng: 6.1432 },
  { city: "Vienna", country: "Austria", lat: 48.2082, lng: 16.3738 },
  { city: "Madrid", country: "Spain", lat: 40.4168, lng: -3.7038 },
  { city: "Barcelona", country: "Spain", lat: 41.3874, lng: 2.1686 },
  { city: "Seville", country: "Spain", lat: 37.3891, lng: -5.9845 },
  { city: "Lisbon", country: "Portugal", lat: 38.7223, lng: -9.1393 },
  { city: "Porto", country: "Portugal", lat: 41.1579, lng: -8.6291 },
  { city: "Rome", country: "Italy", lat: 41.9028, lng: 12.4964 },
  { city: "Milan", country: "Italy", lat: 45.4642, lng: 9.19 },
  { city: "Florence", country: "Italy", lat: 43.7696, lng: 11.2558 },
  { city: "Naples", country: "Italy", lat: 40.8518, lng: 14.2681 },

  // Nordics
  { city: "Stockholm", country: "Sweden", lat: 59.3293, lng: 18.0686 },
  { city: "Oslo", country: "Norway", lat: 59.9139, lng: 10.7522 },
  { city: "Copenhagen", country: "Denmark", lat: 55.6761, lng: 12.5683 },
  { city: "Helsinki", country: "Finland", lat: 60.1699, lng: 24.9384 },
  { city: "Reykjavik", country: "Iceland", lat: 64.1466, lng: -21.9426 },

  // Central & Eastern Europe
  { city: "Warsaw", country: "Poland", lat: 52.2297, lng: 21.0122 },
  { city: "Krakow", country: "Poland", lat: 50.0647, lng: 19.945 },
  { city: "Prague", country: "Czech Republic", lat: 50.0755, lng: 14.4378 },
  { city: "Budapest", country: "Hungary", lat: 47.4979, lng: 19.0402 },
  { city: "Bucharest", country: "Romania", lat: 44.4268, lng: 26.1025 },
  { city: "Belgrade", country: "Serbia", lat: 44.7866, lng: 20.4489 },
  { city: "Novi Sad", country: "Serbia", lat: 45.2671, lng: 19.8335 },
  { city: "Zagreb", country: "Croatia", lat: 45.815, lng: 15.9819 },
  { city: "Split", country: "Croatia", lat: 43.5081, lng: 16.4402 },
  { city: "Ljubljana", country: "Slovenia", lat: 46.0569, lng: 14.5058 },
  { city: "Sarajevo", country: "Bosnia and Herzegovina", lat: 43.8563, lng: 18.4131 },
  { city: "Sofia", country: "Bulgaria", lat: 42.6977, lng: 23.3219 },
  { city: "Athens", country: "Greece", lat: 37.9838, lng: 23.7275 },
  { city: "Thessaloniki", country: "Greece", lat: 40.6401, lng: 22.9444 },

  // Asia-Pacific
  { city: "Tokyo", country: "Japan", lat: 35.6762, lng: 139.6503 },
  { city: "Osaka", country: "Japan", lat: 34.6937, lng: 135.5023 },
  { city: "Kyoto", country: "Japan", lat: 35.0116, lng: 135.7681 },
  { city: "Seoul", country: "South Korea", lat: 37.5665, lng: 126.978 },
  { city: "Taipei", country: "Taiwan", lat: 25.033, lng: 121.5654 },
  { city: "Singapore", country: "Singapore", lat: 1.3521, lng: 103.8198 },
  { city: "Bangkok", country: "Thailand", lat: 13.7563, lng: 100.5018 },
  { city: "Kuala Lumpur", country: "Malaysia", lat: 3.139, lng: 101.6869 },
  { city: "Jakarta", country: "Indonesia", lat: -6.2088, lng: 106.8456 },
  { city: "Sydney", country: "Australia", lat: -33.8688, lng: 151.2093 },
  { city: "Melbourne", country: "Australia", lat: -37.8136, lng: 144.9631 },
  { city: "Brisbane", country: "Australia", lat: -27.4698, lng: 153.0251 },
  { city: "Perth", country: "Australia", lat: -31.9505, lng: 115.8605 },
  { city: "Auckland", country: "New Zealand", lat: -36.8485, lng: 174.7633 },
  { city: "Wellington", country: "New Zealand", lat: -41.2865, lng: 174.7762 },

  // Middle East / Africa
  { city: "Tel Aviv", country: "Israel", lat: 32.0853, lng: 34.7818 },
  { city: "Dubai", country: "United Arab Emirates", lat: 25.2048, lng: 55.2708 },
  { city: "Istanbul", country: "Turkey", lat: 41.0082, lng: 28.9784 },
  { city: "Ankara", country: "Turkey", lat: 39.9334, lng: 32.8597 },
  { city: "Cape Town", country: "South Africa", lat: -33.9249, lng: 18.4241 },
  { city: "Johannesburg", country: "South Africa", lat: -26.2041, lng: 28.0473 },
  { city: "Nairobi", country: "Kenya", lat: -1.2921, lng: 36.8219 },
  { city: "Gaborone", country: "Botswana", lat: -24.6282, lng: 25.9231 },
];

function jitter(value, maxDeg) {
  return value + (Math.random() * 2 - 1) * maxDeg;
}

export function randomSeedPoint() {
  const point = SEED_POINTS[Math.floor(Math.random() * SEED_POINTS.length)];
  // Keep the jitter modest: Mapillary caps a search box at 0.01 square
  // degrees, so straying far from a city centre mostly lands on empty
  // coverage and wastes an attempt.
  return {
    ...point,
    lat: jitter(point.lat, 0.05),
    lng: jitter(point.lng, 0.05),
  };
}
