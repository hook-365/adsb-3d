// Preset places for the Explore feed (feed/explore.ts). A small curated
// list rather than a geocoder: no third-party lookup, no CSP change, and
// it ships offline. Coordinates are city centres (not airport reference
// points) so the 250 NM scope covers every airport serving the city.
// altFt is the approximate ground elevation, used as the flat-ground
// reference when 3D terrain is off.
//
// Regions group the <optgroup>s in the picker. Keep ids stable: they are
// written into URLs (?place=) and remembered per tab.

export interface ExplorePlace {
  id: string;
  name: string;
  country: string;
  region: ExploreRegion;
  lat: number;
  lon: number;
  altFt: number;
  /** State / province for countries where people search by it ("Michigan"). */
  admin?: string;
}

export type ExploreRegion =
  | 'europe'
  | 'north_america'
  | 'south_america'
  | 'middle_east'
  | 'asia'
  | 'oceania'
  | 'africa';

export const EXPLORE_REGIONS: readonly ExploreRegion[] = [
  'europe',
  'north_america',
  'south_america',
  'middle_east',
  'asia',
  'oceania',
  'africa',
];

export const DEFAULT_PLACE_ID = 'rome';

const P = (
  id: string,
  name: string,
  country: string,
  region: ExploreRegion,
  lat: number,
  lon: number,
  altFt = 0,
  admin?: string,
): ExplorePlace => (admin ? { id, name, country, region, lat, lon, altFt, admin } : { id, name, country, region, lat, lon, altFt });

export const EXPLORE_PLACES: readonly ExplorePlace[] = [
  // Europe
  P('rome', 'Rome', 'IT', 'europe', 41.9028, 12.4964, 70),
  P('milan', 'Milan', 'IT', 'europe', 45.4642, 9.19, 400),
  P('naples', 'Naples', 'IT', 'europe', 40.8518, 14.2681, 50),
  P('london', 'London', 'GB', 'europe', 51.5074, -0.1278, 40),
  P('manchester', 'Manchester', 'GB', 'europe', 53.4808, -2.2426, 125),
  P('dublin', 'Dublin', 'IE', 'europe', 53.3498, -6.2603, 60),
  P('paris', 'Paris', 'FR', 'europe', 48.8566, 2.3522, 115),
  P('nice', 'Nice', 'FR', 'europe', 43.7102, 7.262, 30),
  P('amsterdam', 'Amsterdam', 'NL', 'europe', 52.3676, 4.9041, 0),
  P('brussels', 'Brussels', 'BE', 'europe', 50.8503, 4.3517, 180),
  P('frankfurt', 'Frankfurt', 'DE', 'europe', 50.1109, 8.6821, 370),
  P('munich', 'Munich', 'DE', 'europe', 48.1351, 11.582, 1700),
  P('berlin', 'Berlin', 'DE', 'europe', 52.52, 13.405, 115),
  P('hamburg', 'Hamburg', 'DE', 'europe', 53.5511, 9.9937, 20),
  P('zurich', 'Zurich', 'CH', 'europe', 47.3769, 8.5417, 1340),
  P('vienna', 'Vienna', 'AT', 'europe', 48.2082, 16.3738, 560),
  P('prague', 'Prague', 'CZ', 'europe', 50.0755, 14.4378, 770),
  P('warsaw', 'Warsaw', 'PL', 'europe', 52.2297, 21.0122, 330),
  P('copenhagen', 'Copenhagen', 'DK', 'europe', 55.6761, 12.5683, 20),
  P('stockholm', 'Stockholm', 'SE', 'europe', 59.3293, 18.0686, 50),
  P('oslo', 'Oslo', 'NO', 'europe', 59.9139, 10.7522, 75),
  P('helsinki', 'Helsinki', 'FI', 'europe', 60.1699, 24.9384, 60),
  P('madrid', 'Madrid', 'ES', 'europe', 40.4168, -3.7038, 2180),
  P('barcelona', 'Barcelona', 'ES', 'europe', 41.3874, 2.1686, 40),
  P('lisbon', 'Lisbon', 'PT', 'europe', 38.7223, -9.1393, 30),
  P('athens', 'Athens', 'GR', 'europe', 37.9838, 23.7275, 230),
  P('istanbul', 'Istanbul', 'TR', 'europe', 41.0082, 28.9784, 130),
  P('reykjavik', 'Reykjavik', 'IS', 'europe', 64.1466, -21.9426, 50),
  // North America
  P('new_york', 'New York', 'US', 'north_america', 40.7128, -74.006, 30, 'New York'),
  P('washington', 'Washington', 'US', 'north_america', 38.9072, -77.0369, 70, 'District of Columbia'),
  P('boston', 'Boston', 'US', 'north_america', 42.3601, -71.0589, 40, 'Massachusetts'),
  P('chicago', 'Chicago', 'US', 'north_america', 41.8781, -87.6298, 590, 'Illinois'),
  P('detroit', 'Detroit', 'US', 'north_america', 42.3314, -83.0458, 600, 'Michigan'),
  P('atlanta', 'Atlanta', 'US', 'north_america', 33.749, -84.388, 1050, 'Georgia'),
  P('miami', 'Miami', 'US', 'north_america', 25.7617, -80.1918, 5, 'Florida'),
  P('dallas', 'Dallas', 'US', 'north_america', 32.7767, -96.797, 430, 'Texas'),
  P('houston', 'Houston', 'US', 'north_america', 29.7604, -95.3698, 80, 'Texas'),
  P('denver', 'Denver', 'US', 'north_america', 39.7392, -104.9903, 5280, 'Colorado'),
  P('phoenix', 'Phoenix', 'US', 'north_america', 33.4484, -112.074, 1090, 'Arizona'),
  P('las_vegas', 'Las Vegas', 'US', 'north_america', 36.1699, -115.1398, 2000, 'Nevada'),
  P('los_angeles', 'Los Angeles', 'US', 'north_america', 34.0522, -118.2437, 300, 'California'),
  P('san_francisco', 'San Francisco', 'US', 'north_america', 37.7749, -122.4194, 50, 'California'),
  P('seattle', 'Seattle', 'US', 'north_america', 47.6062, -122.3321, 170, 'Washington'),
  P('anchorage', 'Anchorage', 'US', 'north_america', 61.2181, -149.9003, 100, 'Alaska'),
  P('honolulu', 'Honolulu', 'US', 'north_america', 21.3099, -157.8581, 20, 'Hawaii'),
  P('toronto', 'Toronto', 'CA', 'north_america', 43.6532, -79.3832, 250, 'Ontario'),
  P('montreal', 'Montreal', 'CA', 'north_america', 45.5017, -73.5673, 120, 'Quebec'),
  P('vancouver', 'Vancouver', 'CA', 'north_america', 49.2827, -123.1207, 0, 'British Columbia'),
  P('mexico_city', 'Mexico City', 'MX', 'north_america', 19.4326, -99.1332, 7350),
  P('panama_city', 'Panama City', 'PA', 'north_america', 8.9824, -79.5199, 0),
  // South America
  P('sao_paulo', 'São Paulo', 'BR', 'south_america', -23.5505, -46.6333, 2500),
  P('rio', 'Rio de Janeiro', 'BR', 'south_america', -22.9068, -43.1729, 0),
  P('buenos_aires', 'Buenos Aires', 'AR', 'south_america', -34.6037, -58.3816, 80),
  P('santiago', 'Santiago', 'CL', 'south_america', -33.4489, -70.6693, 1700),
  P('lima', 'Lima', 'PE', 'south_america', -12.0464, -77.0428, 500),
  P('bogota', 'Bogotá', 'CO', 'south_america', 4.711, -74.0721, 8660),
  // Middle East
  P('dubai', 'Dubai', 'AE', 'middle_east', 25.2048, 55.2708, 50),
  P('doha', 'Doha', 'QA', 'middle_east', 25.2854, 51.531, 30),
  P('riyadh', 'Riyadh', 'SA', 'middle_east', 24.7136, 46.6753, 2000),
  P('tel_aviv', 'Tel Aviv', 'IL', 'middle_east', 32.0853, 34.7818, 20),
  // Asia
  P('delhi', 'Delhi', 'IN', 'asia', 28.6139, 77.209, 710),
  P('mumbai', 'Mumbai', 'IN', 'asia', 19.076, 72.8777, 40),
  P('bangkok', 'Bangkok', 'TH', 'asia', 13.7563, 100.5018, 5),
  P('singapore', 'Singapore', 'SG', 'asia', 1.3521, 103.8198, 50),
  P('kuala_lumpur', 'Kuala Lumpur', 'MY', 'asia', 3.139, 101.6869, 200),
  P('jakarta', 'Jakarta', 'ID', 'asia', -6.2088, 106.8456, 25),
  P('manila', 'Manila', 'PH', 'asia', 14.5995, 120.9842, 50),
  P('hong_kong', 'Hong Kong', 'HK', 'asia', 22.3193, 114.1694, 30),
  P('taipei', 'Taipei', 'TW', 'asia', 25.033, 121.5654, 30),
  P('shanghai', 'Shanghai', 'CN', 'asia', 31.2304, 121.4737, 15),
  P('beijing', 'Beijing', 'CN', 'asia', 39.9042, 116.4074, 140),
  P('seoul', 'Seoul', 'KR', 'asia', 37.5665, 126.978, 120),
  P('tokyo', 'Tokyo', 'JP', 'asia', 35.6762, 139.6503, 130),
  P('osaka', 'Osaka', 'JP', 'asia', 34.6937, 135.5023, 40),
  // Oceania
  P('sydney', 'Sydney', 'AU', 'oceania', -33.8688, 151.2093, 190, 'New South Wales'),
  P('melbourne', 'Melbourne', 'AU', 'oceania', -37.8136, 144.9631, 100, 'Victoria'),
  P('brisbane', 'Brisbane', 'AU', 'oceania', -27.4698, 153.0251, 90, 'Queensland'),
  P('perth', 'Perth', 'AU', 'oceania', -31.9505, 115.8605, 45, 'Western Australia'),
  P('auckland', 'Auckland', 'NZ', 'oceania', -36.8509, 174.7645, 200),
  // Africa
  P('cairo', 'Cairo', 'EG', 'africa', 30.0444, 31.2357, 75),
  P('johannesburg', 'Johannesburg', 'ZA', 'africa', -26.2041, 28.0473, 5750),
  P('cape_town', 'Cape Town', 'ZA', 'africa', -33.9249, 18.4241, 80),
  P('nairobi', 'Nairobi', 'KE', 'africa', -1.2921, 36.8219, 5450),
  P('lagos', 'Lagos', 'NG', 'africa', 6.5244, 3.3792, 130),
  P('casablanca', 'Casablanca', 'MA', 'africa', 33.5731, -7.5898, 160),
];

const BY_ID: ReadonlyMap<string, ExplorePlace> = new Map(EXPLORE_PLACES.map((p) => [p.id, p]));

export function findPlace(id: string | null | undefined): ExplorePlace | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}
