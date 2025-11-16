import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// ========================
// Mapbox setup
// ========================

mapboxgl.accessToken =
  'pk.eyJ1IjoibGVyZWg4MCIsImEiOiJjbWkxM3Y3MHQwdXZ4MmtxNWZncGJpcXc4In0.YNn7QE3Tp-frF7XYbl3CVA';

console.log('Mapbox GL JS Loaded:', mapboxgl);

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});


function getCoords(station) {
  const point = new mapboxgl.LngLat(station.lon, station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name ?? station.Number ?? station.number;

    const arr = id ? arrivals.get(id) ?? 0 : 0;
    const dep = id ? departures.get(id) ?? 0 : 0;

    station.arrivals = arr;
    station.departures = dep;
    station.totalTraffic = arr + dep;

    return station;
  });
}

const radiusScale = d3.scaleSqrt().range([0, 20]);
const stationFlow = d3
  .scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);

map.on('load', async () => {
  console.log('Map has loaded!');

  const bikeLinePaint = {
    'line-color': '#006400',
    'line-width': 3,
    'line-opacity': 0.6,
  };

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLinePaint,
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLinePaint,
  });

  const stationsUrl =
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

  let stationData;
  try {
    stationData = await d3.json(stationsUrl);
    console.log('Loaded station JSON:', stationData);
  } catch (err) {
    console.error('Error loading station JSON:', err);
    return;
  }

  let stations = stationData?.data?.stations ?? [];
  console.log('Stations Array (raw):', stations);

  if (stations.length > 0) {
    console.log('First station object:', stations[0]);
  }

  stations = stations
    .map((d) => {
      const lonRaw = d.Long ?? d.long ?? d.lon ?? d.Lon ?? d.LONG;
      const latRaw = d.Lat ?? d.lat ?? d.latitude ?? d.Latitude ?? d.LAT;
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      return { ...d, lon, lat };
    })
    .filter((d) => Number.isFinite(d.lon) && Number.isFinite(d.lat));

  console.log('Valid stations:', stations.length);
  if (stations.length === 0) {
    console.warn('No valid stations to draw');
    return;
  }

  const tripsUrl =
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

  let trips = await d3.csv(tripsUrl, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  console.log('Trips loaded:', trips.length);

  stations = computeStationTraffic(stations, trips);
console.log('Stations with traffic (sample):', stations.slice(0, 5));

const globalMaxTraffic =
  d3.max(stations, (d) => d.totalTraffic) || 1;

radiusScale.domain([0, globalMaxTraffic]);

  const svg = d3.select('#map').select('svg');

  let circles = svg
  .selectAll('circle')
  .data(stations, (d) => d.short_name)
  .enter()
  .append('circle')
  .attr('r', (d) => radiusScale(d.totalTraffic))
  .attr('stroke', 'white')
  .attr('stroke-width', 1.5)
  .attr('opacity', 0.6)
  .style('--departure-ratio', (d) => {
    const ratio =
      d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5; 
    return stationFlow(ratio);
  })
  .each(function (d) {
    d3.select(this)
      .append('title')
      .text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
  });

  console.log('Drawing', stations.length, 'station circles');

  // 6. Position circles on map
  function updatePositions() {
    const canvas = map.getCanvas();
    svg.attr('width', canvas.width).attr('height', canvas.height);

    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);



  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

function updateScatterPlot(timeFilter) {
  const filteredTrips = filterTripsByTime(trips, timeFilter);
  const filteredStations = computeStationTraffic(stations, filteredTrips);
  if (timeFilter === -1) {
    radiusScale.range([2, 20]);
  } else {
    radiusScale.range([5, 40]);
  }
  circles = svg
    .selectAll('circle')
    .data(filteredStations, (d) => d.short_name)
    .join('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.6)
    .style('--departure-ratio', (d) => {
      const ratio =
        d.totalTraffic > 0 ? d.departures / d.totalTraffic : 0.5;
      return stationFlow(ratio);
    })
    .each(function (d) {
      let title = d3.select(this).select('title');
      if (title.empty()) title = d3.select(this).append('title');
      title.text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
      );
    });

  updatePositions();
}

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);

  // Initialize to "any time"
  updateTimeDisplay();
});