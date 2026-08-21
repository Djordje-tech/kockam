// Curated real-world locations. Coordinates are real; `wiki` is the Wikipedia
// article title used to fetch a representative photo at request time so we
// never need a paid street-view API key.
export const LOCATIONS = [
  { id: 1, name: "Eiffel Tower", country: "France", lat: 48.8584, lng: 2.2945, wiki: "Eiffel_Tower" },
  { id: 2, name: "Big Ben", country: "United Kingdom", lat: 51.5007, lng: -0.1246, wiki: "Big_Ben" },
  { id: 3, name: "Colosseum", country: "Italy", lat: 41.8902, lng: 12.4922, wiki: "Colosseum" },
  { id: 4, name: "Statue of Liberty", country: "United States", lat: 40.6892, lng: -74.0445, wiki: "Statue_of_Liberty" },
  { id: 5, name: "Sydney Opera House", country: "Australia", lat: -33.8568, lng: 151.2153, wiki: "Sydney_Opera_House" },
  { id: 6, name: "Christ the Redeemer", country: "Brazil", lat: -22.9519, lng: -43.2105, wiki: "Christ_the_Redeemer_(statue)" },
  { id: 7, name: "Taj Mahal", country: "India", lat: 27.1751, lng: 78.0421, wiki: "Taj_Mahal" },
  { id: 8, name: "Great Wall of China", country: "China", lat: 40.4319, lng: 116.5704, wiki: "Great_Wall_of_China" },
  { id: 9, name: "Machu Picchu", country: "Peru", lat: -13.1631, lng: -72.5450, wiki: "Machu_Picchu" },
  { id: 10, name: "Burj Khalifa", country: "United Arab Emirates", lat: 25.1972, lng: 55.2744, wiki: "Burj_Khalifa" },
  { id: 11, name: "Brandenburg Gate", country: "Germany", lat: 52.5163, lng: 13.3777, wiki: "Brandenburg_Gate" },
  { id: 12, name: "Red Square", country: "Russia", lat: 55.7539, lng: 37.6208, wiki: "Red_Square" },
  { id: 13, name: "Acropolis of Athens", country: "Greece", lat: 37.9715, lng: 23.7267, wiki: "Acropolis_of_Athens" },
  { id: 14, name: "Sagrada Familia", country: "Spain", lat: 41.4036, lng: 2.1744, wiki: "Sagrada_Familia" },
  { id: 15, name: "Mount Fuji", country: "Japan", lat: 35.3606, lng: 138.7274, wiki: "Mount_Fuji" },
  { id: 16, name: "Golden Gate Bridge", country: "United States", lat: 37.8199, lng: -122.4783, wiki: "Golden_Gate_Bridge" },
  { id: 17, name: "Neuschwanstein Castle", country: "Germany", lat: 47.5576, lng: 10.7498, wiki: "Neuschwanstein_Castle" },
  { id: 18, name: "Chichen Itza", country: "Mexico", lat: 20.6843, lng: -88.5678, wiki: "Chichen_Itza" },
  { id: 19, name: "Angkor Wat", country: "Cambodia", lat: 13.4125, lng: 103.8670, wiki: "Angkor_Wat" },
  { id: 20, name: "Table Mountain", country: "South Africa", lat: -33.9628, lng: 18.4098, wiki: "Table_Mountain" },
  { id: 21, name: "Petra", country: "Jordan", lat: 30.3285, lng: 35.4444, wiki: "Petra" },
  { id: 22, name: "CN Tower", country: "Canada", lat: 43.6426, lng: -79.3871, wiki: "CN_Tower" },
  { id: 23, name: "Hollywood Sign", country: "United States", lat: 34.1341, lng: -118.3215, wiki: "Hollywood_Sign" },
  { id: 24, name: "Leaning Tower of Pisa", country: "Italy", lat: 43.7230, lng: 10.3966, wiki: "Leaning_Tower_of_Pisa" },
  { id: 25, name: "Mount Rushmore", country: "United States", lat: 43.8791, lng: -103.4591, wiki: "Mount_Rushmore" },
  { id: 26, name: "Stonehenge", country: "United Kingdom", lat: 51.1789, lng: -1.8262, wiki: "Stonehenge" },
  { id: 27, name: "Petronas Towers", country: "Malaysia", lat: 3.1579, lng: 101.7116, wiki: "Petronas_Towers" },
  { id: 28, name: "Forbidden City", country: "China", lat: 39.9163, lng: 116.3972, wiki: "Forbidden_City" },
  { id: 29, name: "Charles Bridge", country: "Czech Republic", lat: 50.0865, lng: 14.4114, wiki: "Charles_Bridge" },
  { id: 30, name: "Plitvice Lakes", country: "Croatia", lat: 44.8654, lng: 15.5820, wiki: "Plitvice_Lakes_National_Park" },
  { id: 31, name: "Kalemegdan Fortress", country: "Serbia", lat: 44.8237, lng: 20.4497, wiki: "Kalemegdan" },
  { id: 32, name: "Niagara Falls", country: "Canada", lat: 43.0962, lng: -79.0377, wiki: "Niagara_Falls" },
  { id: 33, name: "Santorini", country: "Greece", lat: 36.3932, lng: 25.4615, wiki: "Santorini" },
  { id: 34, name: "Dubrovnik Old Town", country: "Croatia", lat: 42.6407, lng: 18.1077, wiki: "Dubrovnik" },
  { id: 35, name: "Times Square", country: "United States", lat: 40.7580, lng: -73.9855, wiki: "Times_Square" },
  { id: 36, name: "Shwedagon Pagoda", country: "Myanmar", lat: 16.7983, lng: 96.1495, wiki: "Shwedagon_Pagoda" },
  { id: 37, name: "Uluru", country: "Australia", lat: -25.3444, lng: 131.0369, wiki: "Uluru" },
  { id: 38, name: "Blue Mosque", country: "Turkey", lat: 41.0054, lng: 28.9768, wiki: "Sultan_Ahmed_Mosque" },
  { id: 39, name: "Matterhorn", country: "Switzerland", lat: 45.9763, lng: 7.6586, wiki: "Matterhorn" },
  { id: 40, name: "Moai Statues", country: "Chile", lat: -27.1127, lng: -109.3497, wiki: "Easter_Island" },
];

export function randomLocation() {
  return LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
}
