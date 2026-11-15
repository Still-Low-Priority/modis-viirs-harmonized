from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from math import (
    asin,
    ceil,
    cos,
    floor,
    isfinite,
    pi,
    radians,
    sin,
    sqrt,
)
from typing import Any, Sequence


EARTH_KM = 6371.0088

SEVERITY_ORDER = {
    "critical": 0,
    "high": 1,
    "elevated": 2,
}


@dataclass(frozen=True, slots=True)
class HotspotDetection:
    id: int
    latitude: float
    longitude: float
    acquired_at: datetime
    source_product: str
    frp: float | None


@dataclass(frozen=True, slots=True)
class _Point:
    detection: HotspotDetection
    lat: float
    lon: float
    timestamp: datetime
    xyz: tuple[float, float, float]


class _UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, value: int) -> int:
        if self.parent[value] != value:
            self.parent[value] = self.find(self.parent[value])
        return self.parent[value]

    def union(self, first: int, second: int) -> None:
        root_a = self.find(first)
        root_b = self.find(second)

        if root_a == root_b:
            return

        if self.rank[root_a] < self.rank[root_b]:
            root_a, root_b = root_b, root_a

        self.parent[root_b] = root_a

        if self.rank[root_a] == self.rank[root_b]:
            self.rank[root_a] += 1


def _wrap_lon(value: float) -> float:
    return ((value + 180.0) % 360.0) - 180.0


def _lon_delta(first: float, second: float) -> float:
    delta = _wrap_lon(second - first)
    return 180.0 if delta == -180.0 else delta


def _to_xyz(
    latitude: float,
    longitude: float,
) -> tuple[float, float, float]:
    lat_rad = radians(latitude)
    lon_rad = radians(longitude)
    cos_lat = cos(lat_rad)

    return (
        cos_lat * cos(lon_rad),
        cos_lat * sin(lon_rad),
        sin(lat_rad),
    )


def _haversine_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)

    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(d_lon / 2) ** 2
    )

    return 2 * EARTH_KM * asin(min(1.0, sqrt(a)))


def _round_to(value: float, digits: int) -> float:
    return float(f"{value:.{digits}f}")


def _floor4(value: float) -> float:
    return floor(value * 1e4 + 1e-9) / 1e4


def _ceil4(value: float) -> float:
    return ceil(value * 1e4 - 1e-9) / 1e4


def _number_string(value: float) -> str:
    if value == 0:
        return "0"

    if value.is_integer():
        return str(int(value))

    return repr(value)


def _base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

    if value == 0:
        return "0"

    result = ""

    while value:
        value, remainder = divmod(value, 36)
        result = alphabet[remainder] + result

    return result


def _hash36(value: str) -> str:
    # FNV-1a, 32-bit.
    result = 0x811C9DC5

    for char in value:
        result ^= ord(char)
        result = (result * 0x01000193) & 0xFFFFFFFF

    return _base36(result)


def _severity(count: int, frp_sum: float) -> str:
    if count >= 100 or frp_sum >= 2000:
        return "critical"

    if count >= 30 or frp_sum >= 500:
        return "high"

    return "elevated"


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)

    return value.astimezone(timezone.utc)


def _datetime_ms(value: datetime) -> int:
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = _to_utc(value) - epoch

    return (
        delta.days * 86_400_000
        + delta.seconds * 1_000
        + delta.microseconds // 1_000
    )


def _prepare_points(
    detections: Sequence[HotspotDetection],
) -> list[_Point]:
    points: list[_Point] = []

    for detection in detections:
        lat = detection.latitude
        lon = detection.longitude

        if not isfinite(lat) or not isfinite(lon):
            continue

        if not (-90 <= lat <= 90):
            continue

        if not (-180 <= lon <= 180):
            continue

        timestamp = _to_utc(detection.acquired_at)
        lon = _wrap_lon(lon)

        points.append(
            _Point(
                detection=detection,
                lat=lat,
                lon=lon,
                timestamp=timestamp,
                xyz=_to_xyz(lat, lon),
            )
        )

    points.sort(
        key=lambda point: (
            point.lat,
            point.lon,
            point.timestamp,
            point.detection.source_product,
            point.detection.id,
        )
    )

    return points


def _box_distance_squared(
    first_min: tuple[float, float, float],
    first_max: tuple[float, float, float],
    second_min: tuple[float, float, float],
    second_max: tuple[float, float, float],
) -> float:
    distance = 0.0

    for axis in range(3):
        gap = max(
            0.0,
            first_min[axis] - second_max[axis],
            second_min[axis] - first_max[axis],
        )
        distance += gap * gap

    return distance


def _cells_are_connected(
    first_members: list[int],
    second_members: list[int],
    points: list[_Point],
    radius_squared: float,
) -> bool:
    tolerance = radius_squared * 1e-12 + 1e-24

    for first_index in first_members:
        x1, y1, z1 = points[first_index].xyz

        for second_index in second_members:
            x2, y2, z2 = points[second_index].xyz

            distance_squared = (
                (x1 - x2) ** 2
                + (y1 - y2) ** 2
                + (z1 - z2) ** 2
            )

            if distance_squared <= radius_squared + tolerance:
                return True

    return False


def _build_clusters(
    points: list[_Point],
    radius_km: float,
) -> list[list[int]]:
    if not points:
        return []

    angle = min(radius_km / EARTH_KM, pi)
    chord_radius = 2.0 * sin(angle / 2.0)

    if chord_radius == 0:
        return [[index] for index in range(len(points))]

    radius_squared = chord_radius**2

    # The diagonal of a cubic cell cannot exceed the neighbour distance.
    cell_side = chord_radius / sqrt(3.0)

    cells: dict[tuple[int, int, int], list[int]] = defaultdict(list)

    for index, point in enumerate(points):
        key = (
            floor((point.xyz[0] + 1.0) / cell_side),
            floor((point.xyz[1] + 1.0) / cell_side),
            floor((point.xyz[2] + 1.0) / cell_side),
        )
        cells[key].append(index)

    keys = sorted(cells)
    key_to_index = {
        key: index
        for index, key in enumerate(keys)
    }

    bounds: list[
        tuple[
            tuple[float, float, float],
            tuple[float, float, float],
        ]
    ] = []

    for key in keys:
        coordinates = [
            points[index].xyz
            for index in cells[key]
        ]

        minimum = (
            min(point[0] for point in coordinates),
            min(point[1] for point in coordinates),
            min(point[2] for point in coordinates),
        )

        maximum = (
            max(point[0] for point in coordinates),
            max(point[1] for point in coordinates),
            max(point[2] for point in coordinates),
        )

        bounds.append((minimum, maximum))

    union_find = _UnionFind(len(keys))
    offsets = range(-2, 3)

    for first_index, first_key in enumerate(keys):
        first_min, first_max = bounds[first_index]
        first_members = cells[first_key]

        for dx in offsets:
            for dy in offsets:
                for dz in offsets:
                    if dx == dy == dz == 0:
                        continue

                    second_key = (
                        first_key[0] + dx,
                        first_key[1] + dy,
                        first_key[2] + dz,
                    )

                    second_index = key_to_index.get(second_key)

                    if (
                        second_index is None
                        or second_index <= first_index
                    ):
                        continue

                    second_min, second_max = bounds[second_index]

                    if (
                        _box_distance_squared(
                            first_min,
                            first_max,
                            second_min,
                            second_max,
                        )
                        > radius_squared * (1 + 1e-12) + 1e-24
                    ):
                        continue

                    if _cells_are_connected(
                        first_members,
                        cells[second_key],
                        points,
                        radius_squared,
                    ):
                        union_find.union(first_index, second_index)

    grouped_cells: dict[int, list[int]] = defaultdict(list)

    for cell_index in range(len(keys)):
        root = union_find.find(cell_index)
        grouped_cells[root].append(cell_index)

    clusters: list[list[int]] = []

    for cell_indexes in grouped_cells.values():
        members: list[int] = []

        for cell_index in cell_indexes:
            members.extend(cells[keys[cell_index]])

        clusters.append(members)

    return clusters


def _build_hotspot(
    member_indexes: list[int],
    points: list[_Point],
) -> dict[str, Any]:
    members = [points[index] for index in member_indexes]

    members.sort(
        key=lambda point: (
            point.lat,
            point.lon,
            point.timestamp,
            point.detection.source_product,
            point.detection.id,
        )
    )

    count = len(members)
    reference_lon = members[0].lon

    center_lat = _round_to(
        sum(point.lat for point in members) / count,
        4,
    )

    center_lon = _wrap_lon(
        reference_lon
        + sum(
            _lon_delta(reference_lon, point.lon)
            for point in members
        ) / count
    )
    center_lon = _round_to(center_lon, 4)

    frp_values = [
        point.detection.frp
        if (
            point.detection.frp is not None
            and isfinite(point.detection.frp)
            and point.detection.frp > 0
        )
        else 0.0
        for point in members
    ]

    frp_sum = _round_to(sum(frp_values), 1)
    frp_max = _round_to(max(frp_values, default=0.0), 1)

    first_seen = min(point.timestamp for point in members)
    last_seen = max(point.timestamp for point in members)

    radius = max(
        1.0,
        max(
            _haversine_km(
                center_lat,
                center_lon,
                point.lat,
                point.lon,
            )
            for point in members
        ),
    )
    radius = ceil(radius * 10 - 1e-9) / 10

    south = min(point.lat for point in members)
    north = max(point.lat for point in members)

    longitude_offsets = [
        _lon_delta(center_lon, point.lon)
        for point in members
    ]

    west = center_lon + min(longitude_offsets)
    east = center_lon + max(longitude_offsets)

    epsilon = 1e-9

    west = (
        _floor4(_wrap_lon(west))
        if west < -180 - epsilon
        else max(-180.0, _floor4(west))
    )

    east = (
        _ceil4(_wrap_lon(east))
        if east > 180 + epsilon
        else min(180.0, _ceil4(east))
    )

    bbox = [
        west,
        _floor4(south),
        east,
        _ceil4(north),
    ]

    by_source: dict[str, int] = {}

    for point in members:
        source = point.detection.source_product
        by_source[source] = by_source.get(source, 0) + 1

    hash_input = "|".join(
        (
            str(_datetime_ms(first_seen)),
            str(_datetime_ms(last_seen)),
            _number_string(frp_sum),
            _number_string(south),
            _number_string(north),
        )
    )

    hotspot_id = (
        f"{center_lat:.3f}_"
        f"{center_lon:.3f}_"
        f"{count}_"
        f"{_hash36(hash_input)}"
    )

    return {
        "id": hotspot_id,
        "lat": center_lat,
        "lon": center_lon,
        "radius_km": radius,
        "bbox": bbox,
        "count": count,
        "frp_sum": frp_sum,
        "frp_max": frp_max,
        "first_seen": first_seen.replace(microsecond=0),
        "last_seen": last_seen.replace(microsecond=0),
        "by_source": by_source,
        "severity": _severity(count, frp_sum),
    }


def cluster_hotspots(
    detections: Sequence[HotspotDetection],
    *,
    radius_km: float = 10.0,
    min_count: int = 10,
    limit: int = 50,
) -> dict[str, Any]:
    if not isfinite(radius_km) or radius_km <= 0:
        raise ValueError("radius_km must be a positive finite number")

    if min_count < 1:
        raise ValueError("min_count must be at least 1")

    if limit < 0:
        raise ValueError("limit cannot be negative")

    points = _prepare_points(detections)

    if not points:
        return {
            "radius_km": radius_km,
            "min_count": min_count,
            "total": 0,
            "approximate": False,
            "items": [],
        }

    clusters = _build_clusters(points, radius_km)

    items = [
        _build_hotspot(cluster, points)
        for cluster in clusters
        if len(cluster) >= min_count
    ]

    items.sort(
        key=lambda item: (
            SEVERITY_ORDER[item["severity"]],
            -item["count"],
            -item["frp_sum"],
            item["id"],
        )
    )

    seen: dict[str, int] = {}

    for item in items:
        base_id = item["id"]
        occurrence = seen.get(base_id, 0)
        seen[base_id] = occurrence + 1

        if occurrence:
            item["id"] = f"{base_id}-{occurrence + 1}"

    return {
        "radius_km": radius_km,
        "min_count": min_count,
        "total": len(items),
        "approximate": False,
        "items": items[:limit],
    }
