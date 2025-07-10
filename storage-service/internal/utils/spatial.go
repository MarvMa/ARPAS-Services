// Create: storage-service/internal/utils/spatial.go
package utils

import "math"

// HaversineDistance calculates the distance between two points using the Haversine formula
func HaversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0

	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLng := (lng2 - lng1) * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLng/2)*math.Sin(dLng/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	distance := earthRadiusKm * c * 1000 // Convert to meters

	return distance
}

// CalculateBoundingBox calculates a rough bounding box for optimization
func CalculateBoundingBox(lat, lng, radiusMeters float64) (minLat, maxLat, minLng, maxLng float64) {
	// Approximate degrees per meter at the given latitude
	latDegreePerMeter := 1.0 / 111320.0
	lngDegreePerMeter := 1.0 / (111320.0 * math.Cos(lat*math.Pi/180.0))

	deltaLat := radiusMeters * latDegreePerMeter
	deltaLng := radiusMeters * lngDegreePerMeter

	minLat = lat - deltaLat
	maxLat = lat + deltaLat
	minLng = lng - deltaLng
	maxLng = lng + deltaLng

	return minLat, maxLat, minLng, maxLng
}
