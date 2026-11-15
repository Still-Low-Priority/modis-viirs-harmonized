import random
from datetime import datetime, timedelta, timezone
from math import cos, inf, nan, pi, radians

import pytest

from app.services import hotspots
from app.services.hotspots import (
    EARTH_KM,
    HotspotDetection,
    cluster_hotspots,
)


T0 = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
KM_PER_DEGREE = EARTH_KM * pi / 180.0


def make_detection(
    detection_id: int,
    latitude: float,
    longitude: float,
    *,
    frp: float | None = 1.0,
    source_product: str = "MODIS_NRT",
    acquired_at: datetime = T0,
) -> HotspotDetection:
    return HotspotDetection(
        id=detection_id,
        latitude=latitude,
        longitude=longitude,
        acquired_at=acquired_at,
        source_product=source_product,
        frp=frp,
    )


def make_group(
    count: int,
    *,
    latitude: float = 0.0,
    longitude: float = 0.0,
    frp: float | None = 1.0,
    first_id: int = 1,
    source_product: str = "MODIS_NRT",
) -> list[HotspotDetection]:
    # Detections spaced ~11 m apart along a meridian: always one group.
    return [
        make_detection(
            first_id + index,
            latitude + index * 0.0001,
            longitude,
            frp=frp,
            source_product=source_product,
        )
        for index in range(count)
    ]


def km_east(km: float, latitude: float = 0.0) -> float:
    return km / (KM_PER_DEGREE * cos(radians(latitude)))


def in_bbox(bbox: list[float], latitude: float, longitude: float) -> bool:
    west, south, east, north = bbox
    tolerance = 1e-4

    if not (south - tolerance <= latitude <= north + tolerance):
        return False

    if west <= east:
        return west - tolerance <= longitude <= east + tolerance

    return longitude >= west - tolerance or longitude <= east + tolerance


def brute_force_group_sizes(
    detections: list[HotspotDetection],
    radius_km: float,
) -> list[int]:
    parent = list(range(len(detections)))

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    for first in range(len(detections)):
        for second in range(first + 1, len(detections)):
            distance = hotspots._haversine_km(
                detections[first].latitude,
                detections[first].longitude,
                detections[second].latitude,
                detections[second].longitude,
            )

            if distance <= radius_km:
                parent[find(first)] = find(second)

    sizes: dict[int, int] = {}

    for index in range(len(detections)):
        root = find(index)
        sizes[root] = sizes.get(root, 0) + 1

    return sorted(sizes.values())


# --- severity -------------------------------------------------------------


@pytest.mark.parametrize(
    ("count", "frp_sum", "expected"),
    [
        (1, 0.0, "elevated"),
        (29, 499.9, "elevated"),
        (30, 0.0, "high"),
        (1, 500.0, "high"),
        (99, 1999.9, "high"),
        (100, 0.0, "critical"),
        (1, 2000.0, "critical"),
        (1000, 99999.0, "critical"),
    ],
)
def test_severity_thresholds(
    count: int,
    frp_sum: float,
    expected: str,
) -> None:
    assert hotspots._severity(count, frp_sum) == expected


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (29, "elevated"),
        (30, "high"),
        (99, "high"),
        (100, "critical"),
    ],
)
def test_cluster_severity_follows_detection_count(
    count: int,
    expected: str,
) -> None:
    result = cluster_hotspots(make_group(count, frp=None), min_count=1)

    assert result["total"] == 1
    assert result["items"][0]["count"] == count
    assert result["items"][0]["severity"] == expected


@pytest.mark.parametrize(
    ("frp", "expected_sum", "expected"),
    [
        (249.9, 499.8, "elevated"),
        (250.0, 500.0, "high"),
        (999.9, 1999.8, "high"),
        (1000.0, 2000.0, "critical"),
    ],
)
def test_cluster_severity_follows_frp_sum(
    frp: float,
    expected_sum: float,
    expected: str,
) -> None:
    result = cluster_hotspots(make_group(2, frp=frp), min_count=1)

    assert result["items"][0]["frp_sum"] == expected_sum
    assert result["items"][0]["severity"] == expected


# --- stable ids -----------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "0"),
        (9, "9"),
        (10, "a"),
        (35, "z"),
        (36, "10"),
        (36 * 36 - 1, "zz"),
        (0xFFFFFFFF, "1z141z3"),
    ],
)
def test_base36(value: int, expected: str) -> None:
    assert hotspots._base36(value) == expected
    assert int(expected, 36) == value


@pytest.mark.parametrize(
    ("value", "fnv1a_32"),
    [
        ("", 0x811C9DC5),
        ("a", 0xE40C292C),
        ("foobar", 0xBF9CF968),
    ],
)
def test_hash36_is_fnv1a_32_in_base36(value: str, fnv1a_32: int) -> None:
    assert int(hotspots._hash36(value), 36) == fnv1a_32


def test_hotspot_id_format_and_value() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 49.0, 31.0, frp=2.5),
            make_detection(
                2,
                49.01,
                31.01,
                frp=3.26,
                source_product="VIIRS_SNPP_NRT",
                acquired_at=T0 + timedelta(hours=1),
            ),
        ],
        min_count=1,
    )

    item = result["items"][0]
    first_ms = int(T0.timestamp() * 1000)
    last_ms = first_ms + 3_600_000

    assert item["id"] == "49.005_31.005_2_" + hotspots._hash36(
        f"{first_ms}|{last_ms}|5.8|49|49.01"
    )


def test_hotspot_id_does_not_depend_on_input_order_or_row_ids() -> None:
    rng = random.Random(7)
    detections = [
        make_detection(
            index,
            48.0 + rng.uniform(0, 1.5),
            30.0 + rng.uniform(0, 1.5),
            frp=rng.uniform(0, 80),
            acquired_at=T0 + timedelta(minutes=rng.randrange(0, 600)),
        )
        for index in range(200)
    ]

    shuffled = [
        HotspotDetection(
            id=10_000 - detection.id,
            latitude=detection.latitude,
            longitude=detection.longitude,
            acquired_at=detection.acquired_at,
            source_product=detection.source_product,
            frp=detection.frp,
        )
        for detection in detections
    ]
    rng.shuffle(shuffled)

    first = cluster_hotspots(detections, min_count=1, limit=1000)
    second = cluster_hotspots(shuffled, min_count=1, limit=1000)

    assert first["total"] > 1
    assert first == second


def test_hotspot_id_changes_when_the_group_changes() -> None:
    base = make_group(3)
    later = base[:2] + [
        make_detection(
            3,
            base[2].latitude,
            base[2].longitude,
            acquired_at=T0 + timedelta(seconds=1),
        )
    ]

    first = cluster_hotspots(base, min_count=1)["items"][0]["id"]
    second = cluster_hotspots(later, min_count=1)["items"][0]["id"]

    assert first != second


def test_colliding_ids_get_a_numeric_suffix() -> None:
    # Two single-point groups ~2 m apart that round to the same id.
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 10.00001),
            make_detection(2, 0.0, 10.00003),
        ],
        radius_km=0.001,
        min_count=1,
    )

    ids = [item["id"] for item in result["items"]]

    assert result["total"] == 2
    assert ids[1] == f"{ids[0]}-2"
    assert len(set(ids)) == 2


# --- grouping -------------------------------------------------------------


def test_empty_input_returns_empty_result() -> None:
    assert cluster_hotspots([]) == {
        "radius_km": 10.0,
        "min_count": 10,
        "total": 0,
        "approximate": False,
        "items": [],
    }


def test_defaults_are_ten_km_and_ten_detections() -> None:
    result = cluster_hotspots(make_group(10))

    assert result["radius_km"] == 10.0
    assert result["min_count"] == 10
    assert result["total"] == 1


@pytest.mark.parametrize(
    ("distance_km", "expected_groups"),
    [
        (0.0, 1),
        (5.0, 1),
        (9.99, 1),
        (10.01, 2),
        (50.0, 2),
    ],
)
def test_default_radius_boundary(
    distance_km: float,
    expected_groups: int,
) -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, km_east(distance_km)),
        ],
        min_count=1,
    )

    assert result["total"] == expected_groups


@pytest.mark.parametrize("latitude", [0.0, 49.0, -60.0, 80.0])
@pytest.mark.parametrize(
    ("radius_km", "distance_km", "expected_groups"),
    [
        (1.0, 0.99, 1),
        (1.0, 1.01, 2),
        (25.0, 24.9, 1),
        (25.0, 25.1, 2),
    ],
)
def test_custom_radius_boundary_at_any_latitude(
    latitude: float,
    radius_km: float,
    distance_km: float,
    expected_groups: int,
) -> None:
    # East-west separation: the group radius is a real distance in km,
    # not a fixed number of degrees.
    result = cluster_hotspots(
        [
            make_detection(1, latitude, 20.0),
            make_detection(
                2,
                latitude,
                20.0 + km_east(distance_km, latitude),
            ),
        ],
        radius_km=radius_km,
        min_count=1,
    )

    assert result["total"] == expected_groups


def test_grouping_is_transitive() -> None:
    # A-B and B-C are ~9 km apart, A-C ~18 km: still one hotspot.
    step = km_east(9.0)

    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, step),
            make_detection(3, 0.0, 2 * step),
        ],
        min_count=1,
    )

    assert result["total"] == 1
    assert result["items"][0]["count"] == 3


def test_chain_breaks_where_the_gap_exceeds_the_radius() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, km_east(9.0)),
            make_detection(3, 0.0, km_east(9.0 + 10.5)),
        ],
        min_count=1,
    )

    assert sorted(item["count"] for item in result["items"]) == [1, 2]


@pytest.mark.parametrize(
    ("min_count", "expected_counts"),
    [
        (1, [5, 3, 1]),
        (2, [5, 3]),
        (3, [5, 3]),
        (4, [5]),
        (5, [5]),
        (6, []),
    ],
)
def test_groups_smaller_than_min_count_are_dropped(
    min_count: int,
    expected_counts: list[int],
) -> None:
    detections = (
        make_group(5, longitude=0.0)
        + make_group(3, longitude=1.0, first_id=100)
        + make_group(1, longitude=2.0, first_id=200)
    )

    result = cluster_hotspots(detections, min_count=min_count)

    assert [item["count"] for item in result["items"]] == expected_counts
    assert result["total"] == len(expected_counts)
    assert result["min_count"] == min_count


@pytest.mark.parametrize("seed", range(12))
def test_grouping_matches_brute_force_union_find(seed: int) -> None:
    rng = random.Random(seed)
    region = seed % 4
    detections = []

    for index in range(120):
        if region == 0:
            latitude = rng.uniform(48.0, 49.0)
            longitude = rng.uniform(30.0, 31.5)
        elif region == 1:
            latitude = rng.uniform(-1.0, 1.0)
            longitude = (rng.uniform(179.0, 181.0) + 180.0) % 360.0 - 180.0
        elif region == 2:
            latitude = rng.uniform(89.3, 90.0)
            longitude = rng.uniform(-180.0, 180.0)
        else:
            latitude = rng.uniform(-90.0, -89.3)
            longitude = rng.uniform(-180.0, 180.0)

        detections.append(make_detection(index, latitude, longitude))

    radius_km = rng.choice([3.0, 10.0, 25.0])

    result = cluster_hotspots(
        detections,
        radius_km=radius_km,
        min_count=1,
        limit=10_000,
    )

    assert sorted(item["count"] for item in result["items"]) == (
        brute_force_group_sizes(detections, radius_km)
    )


@pytest.mark.parametrize("radius_km", [300.0, 2500.0])
def test_grouping_matches_brute_force_for_large_radius(
    radius_km: float,
) -> None:
    rng = random.Random(int(radius_km))
    detections = [
        make_detection(
            index,
            rng.uniform(-90.0, 90.0),
            rng.uniform(-180.0, 180.0),
        )
        for index in range(60)
    ]

    result = cluster_hotspots(
        detections,
        radius_km=radius_km,
        min_count=1,
        limit=10_000,
    )

    assert sorted(item["count"] for item in result["items"]) == (
        brute_force_group_sizes(detections, radius_km)
    )


def test_radius_larger_than_the_planet_groups_everything() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, 90.0),
            make_detection(3, 0.0, 180.0),
            make_detection(4, -90.0, 0.0),
        ],
        radius_km=1e9,
        min_count=1,
    )

    assert result["total"] == 1
    assert result["items"][0]["count"] == 4


def test_tiny_radius_only_groups_coincident_detections() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, 0.0),
            make_detection(3, 0.0, 0.001),
        ],
        radius_km=1e-300,
        min_count=1,
    )

    assert result["total"] == 2
    assert [item["count"] for item in result["items"]] == [2, 1]


@pytest.mark.xfail(
    strict=True,
    reason=(
        "_build_clusters: when radius_km is so small that the chord length "
        "underflows to 0 (chord_radius == 0 branch) every detection becomes "
        "its own group, so coincident detections (distance 0 <= radius) are "
        "split, unlike for any other radius"
    ),
)
def test_coincident_detections_are_grouped_for_a_denormal_radius() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0),
            make_detection(2, 0.0, 0.0),
        ],
        radius_km=5e-324,
        min_count=1,
    )

    assert result["total"] == 1
    assert result["items"][0]["count"] == 2


# --- hotspot summary ------------------------------------------------------


def test_hotspot_summary_fields() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 49.0, 31.0, frp=2.5),
            make_detection(
                2,
                49.01,
                31.01,
                frp=3.26,
                source_product="VIIRS_SNPP_NRT",
                acquired_at=T0 + timedelta(hours=1, microseconds=987_654),
            ),
            make_detection(
                3,
                49.02,
                31.02,
                frp=10.0,
                source_product="VIIRS_SNPP_NRT",
                acquired_at=T0 - timedelta(hours=2),
            ),
        ],
        min_count=3,
    )

    assert result["total"] == 1
    item = result["items"][0]

    assert set(item) == {
        "id",
        "lat",
        "lon",
        "radius_km",
        "bbox",
        "count",
        "frp_sum",
        "frp_max",
        "first_seen",
        "last_seen",
        "by_source",
        "severity",
    }
    assert item["lat"] == 49.01
    assert item["lon"] == 31.01
    assert item["bbox"] == [31.0, 49.0, 31.02, 49.02]
    assert item["count"] == 3
    assert item["frp_sum"] == 15.8
    assert item["frp_max"] == 10.0
    assert item["first_seen"] == T0 - timedelta(hours=2)
    # Sub-second precision is dropped from the reported timestamps.
    assert item["last_seen"] == T0 + timedelta(hours=1)
    assert item["by_source"] == {"MODIS_NRT": 1, "VIIRS_SNPP_NRT": 2}
    assert item["severity"] == "elevated"
    # ~1.33 km from the centre to the far corner, rounded up to 0.1 km.
    assert item["radius_km"] == 1.4


def test_reported_radius_is_at_least_one_km() -> None:
    result = cluster_hotspots([make_detection(1, 10.0, 10.0)], min_count=1)

    assert result["items"][0]["radius_km"] == 1.0


def test_reported_radius_and_bbox_cover_every_member() -> None:
    rng = random.Random(3)
    detections = [
        make_detection(
            index,
            -33.0 + rng.uniform(0, 0.3),
            150.0 + rng.uniform(0, 0.3),
        )
        for index in range(80)
    ]

    result = cluster_hotspots(detections, radius_km=50.0, min_count=1)

    assert result["total"] == 1
    item = result["items"][0]

    for detection in detections:
        assert in_bbox(item["bbox"], detection.latitude, detection.longitude)
        assert (
            hotspots._haversine_km(
                item["lat"],
                item["lon"],
                detection.latitude,
                detection.longitude,
            )
            <= item["radius_km"]
        )


@pytest.mark.parametrize("frp", [None, nan, inf, -inf, -5.0, 0.0])
def test_missing_or_invalid_frp_counts_as_zero(frp: float | None) -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0, frp=frp),
            make_detection(2, 0.0, 0.001, frp=4.0),
        ],
        min_count=1,
    )

    item = result["items"][0]

    assert item["count"] == 2
    assert item["frp_sum"] == 4.0
    assert item["frp_max"] == 4.0


def test_group_without_any_frp_reports_zero() -> None:
    result = cluster_hotspots(make_group(3, frp=None), min_count=1)

    assert result["items"][0]["frp_sum"] == 0.0
    assert result["items"][0]["frp_max"] == 0.0


def test_naive_timestamps_are_treated_as_utc() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 0.0, acquired_at=datetime(2026, 1, 1, 12)),
            make_detection(
                2,
                0.0,
                0.0,
                acquired_at=datetime(
                    2026,
                    1,
                    1,
                    15,
                    tzinfo=timezone(timedelta(hours=2)),
                ),
            ),
        ],
        min_count=1,
    )

    item = result["items"][0]

    assert item["first_seen"] == datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    assert item["last_seen"] == datetime(2026, 1, 1, 13, tzinfo=timezone.utc)
    assert item["first_seen"].utcoffset() == timedelta(0)
    assert item["last_seen"].utcoffset() == timedelta(0)


# --- ordering and limit ---------------------------------------------------


def test_items_are_ordered_by_severity_then_count_then_frp() -> None:
    detections = (
        # elevated, 12 detections
        make_group(12, longitude=0.0, frp=1.0, first_id=0)
        # high through FRP, only 2 detections
        + make_group(2, longitude=1.0, frp=300.0, first_id=100)
        # critical through FRP, a single detection
        + make_group(1, longitude=2.0, frp=2500.0, first_id=200)
        # high through count
        + make_group(30, longitude=3.0, frp=0.0, first_id=300)
        # elevated, 5 detections, more FRP than the next group
        + make_group(5, longitude=4.0, frp=20.0, first_id=400)
        # elevated, 5 detections
        + make_group(5, longitude=5.0, frp=2.0, first_id=500)
    )

    result = cluster_hotspots(detections, min_count=1)

    assert [
        (item["severity"], item["count"], item["frp_sum"])
        for item in result["items"]
    ] == [
        ("critical", 1, 2500.0),
        ("high", 30, 0.0),
        ("high", 2, 600.0),
        ("elevated", 12, 12.0),
        ("elevated", 5, 100.0),
        ("elevated", 5, 10.0),
    ]


def test_full_ties_are_ordered_by_id() -> None:
    detections = [
        make_detection(1, 5.0, 30.0),
        make_detection(2, 5.0, 10.0),
        make_detection(3, 5.0, 20.0),
    ]

    result = cluster_hotspots(detections, min_count=1)
    ids = [item["id"] for item in result["items"]]

    assert len(ids) == 3
    assert ids == sorted(ids)


@pytest.mark.parametrize(
    ("limit", "expected_items"),
    [
        (0, 0),
        (1, 1),
        (2, 2),
        (3, 3),
        (50, 3),
    ],
)
def test_limit_truncates_items_but_not_total(
    limit: int,
    expected_items: int,
) -> None:
    detections = (
        make_group(4, longitude=0.0)
        + make_group(3, longitude=1.0, first_id=100)
        + make_group(2, longitude=2.0, first_id=200)
    )

    result = cluster_hotspots(detections, min_count=1, limit=limit)

    assert result["total"] == 3
    assert len(result["items"]) == expected_items
    assert [item["count"] for item in result["items"]] == [4, 3, 2][:limit]


def test_default_limit_is_fifty() -> None:
    detections = [
        make_detection(index, 0.0, -170.0 + index * 5.0)
        for index in range(60)
    ]

    result = cluster_hotspots(detections, min_count=1)

    assert result["total"] == 60
    assert len(result["items"]) == 50


# --- antimeridian and poles -----------------------------------------------


def test_group_spans_the_antimeridian() -> None:
    detections = [
        make_detection(1, 10.0, 179.9),
        make_detection(2, 10.0, -179.8),
    ]

    result = cluster_hotspots(detections, radius_km=50.0, min_count=2)

    assert result["total"] == 1
    item = result["items"][0]

    assert item["count"] == 2
    assert item["lat"] == 10.0
    assert item["lon"] == -179.95
    # west > east marks a bbox that crosses the 180th meridian.
    assert item["bbox"] == [179.9, 10.0, -179.8, 10.0]
    # Half of the ~32.8 km between the points, not half the planet.
    assert item["radius_km"] == 16.5


def test_antimeridian_neighbours_within_default_radius() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 179.97),
            make_detection(2, 0.0, -179.97),
        ],
        min_count=1,
    )

    assert result["total"] == 1
    assert abs(result["items"][0]["lon"]) == 180.0
    assert result["items"][0]["bbox"] == [179.97, 0.0, -179.97, 0.0]


def test_antimeridian_points_too_far_apart_stay_separate() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 0.0, 179.9),
            make_detection(2, 0.0, -179.9),
        ],
        min_count=1,
    )

    assert result["total"] == 2


def test_longitude_180_and_minus_180_are_the_same_place() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 10.0, 180.0),
            make_detection(2, 10.0, -180.0),
        ],
        radius_km=0.001,
        min_count=2,
    )

    assert result["total"] == 1
    item = result["items"][0]

    assert item["lon"] == -180.0
    assert item["bbox"] == [-180.0, 10.0, -180.0, 10.0]
    assert item["radius_km"] == 1.0


@pytest.mark.parametrize("pole", [90.0, -90.0])
def test_pole_is_one_point_whatever_the_longitude(pole: float) -> None:
    result = cluster_hotspots(
        [
            make_detection(1, pole, 0.0),
            make_detection(2, pole, 120.0),
            make_detection(3, pole, -120.0),
        ],
        radius_km=0.001,
        min_count=3,
    )

    assert result["total"] == 1
    assert result["items"][0]["lat"] == pole
    assert result["items"][0]["radius_km"] == 1.0


@pytest.mark.parametrize("sign", [1.0, -1.0])
def test_detections_on_opposite_sides_of_a_pole_are_grouped(
    sign: float,
) -> None:
    # 0.03 degrees from the pole on opposite meridians: ~6.7 km apart.
    detections = [
        make_detection(1, sign * 89.97, 10.0),
        make_detection(2, sign * 89.97, -170.0),
    ]

    result = cluster_hotspots(detections, min_count=2)

    assert result["total"] == 1
    item = result["items"][0]

    assert item["count"] == 2
    assert item["lat"] == sign * 89.97

    for detection in detections:
        assert in_bbox(item["bbox"], detection.latitude, detection.longitude)
        assert (
            hotspots._haversine_km(
                item["lat"],
                item["lon"],
                detection.latitude,
                detection.longitude,
            )
            <= item["radius_km"]
        )


def test_ring_around_the_pole_is_covered_by_its_bbox() -> None:
    detections = [
        make_detection(index, 89.99, -180.0 + index * 30.0)
        for index in range(12)
    ]

    result = cluster_hotspots(detections, min_count=12)

    assert result["total"] == 1
    item = result["items"][0]

    assert -180.0 <= item["lon"] <= 180.0
    assert -180.0 <= item["bbox"][0] <= 180.0
    assert -180.0 <= item["bbox"][2] <= 180.0

    for detection in detections:
        assert in_bbox(item["bbox"], detection.latitude, detection.longitude)


@pytest.mark.parametrize(
    ("first", "second", "expected"),
    [
        (0.0, 10.0, 10.0),
        (10.0, 0.0, -10.0),
        (179.0, -179.0, 2.0),
        (-179.0, 179.0, -2.0),
        (0.0, 180.0, 180.0),
        (0.0, -180.0, 180.0),
        (-90.0, 90.0, 180.0),
    ],
)
def test_lon_delta_takes_the_short_way_round(
    first: float,
    second: float,
    expected: float,
) -> None:
    assert hotspots._lon_delta(first, second) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0.0, 0.0),
        (179.5, 179.5),
        (180.0, -180.0),
        (-180.0, -180.0),
        (190.0, -170.0),
        (-190.0, 170.0),
        (360.0, 0.0),
    ],
)
def test_wrap_lon(value: float, expected: float) -> None:
    assert hotspots._wrap_lon(value) == pytest.approx(expected)


def test_haversine_known_distances() -> None:
    assert hotspots._haversine_km(0.0, 0.0, 0.0, 0.0) == 0.0
    assert hotspots._haversine_km(0.0, 0.0, 0.0, 1.0) == pytest.approx(
        KM_PER_DEGREE
    )
    assert hotspots._haversine_km(0.0, 0.0, 0.0, 180.0) == pytest.approx(
        EARTH_KM * pi
    )
    assert hotspots._haversine_km(90.0, 0.0, -90.0, 77.0) == pytest.approx(
        EARTH_KM * pi
    )
    assert hotspots._haversine_km(0.0, 179.5, 0.0, -179.5) == pytest.approx(
        KM_PER_DEGREE
    )


# --- input validation -----------------------------------------------------


@pytest.mark.parametrize("radius_km", [0.0, -0.0, -1.0, -10.0, nan, inf, -inf])
def test_bad_radius_is_rejected(radius_km: float) -> None:
    with pytest.raises(ValueError, match="radius_km"):
        cluster_hotspots(make_group(3), radius_km=radius_km, min_count=1)


@pytest.mark.parametrize("min_count", [0, -1, -100])
def test_bad_min_count_is_rejected(min_count: int) -> None:
    with pytest.raises(ValueError, match="min_count"):
        cluster_hotspots(make_group(3), min_count=min_count)


@pytest.mark.parametrize("limit", [-1, -50])
def test_negative_limit_is_rejected(limit: int) -> None:
    with pytest.raises(ValueError, match="limit"):
        cluster_hotspots(make_group(3), min_count=1, limit=limit)


def test_arguments_are_validated_even_without_detections() -> None:
    with pytest.raises(ValueError):
        cluster_hotspots([], radius_km=0.0)


def test_radius_and_min_count_are_echoed_back() -> None:
    result = cluster_hotspots(make_group(2), radius_km=2.5, min_count=2)

    assert result["radius_km"] == 2.5
    assert result["min_count"] == 2
    assert result["approximate"] is False


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (90.0001, 0.0),
        (-90.0001, 0.0),
        (91.0, 0.0),
        (-200.0, 0.0),
        (0.0, 180.0001),
        (0.0, -180.0001),
        (0.0, 360.0),
        (nan, 0.0),
        (0.0, nan),
        (inf, 0.0),
        (0.0, -inf),
    ],
)
def test_detections_with_invalid_coordinates_are_ignored(
    latitude: float,
    longitude: float,
) -> None:
    valid = make_group(2)

    result = cluster_hotspots(
        valid + [make_detection(99, latitude, longitude, frp=5000.0)],
        radius_km=1e9,
        min_count=1,
    )

    assert result["total"] == 1
    assert result["items"][0]["count"] == 2
    assert result["items"][0]["frp_sum"] == 2.0


def test_only_invalid_coordinates_gives_an_empty_result() -> None:
    result = cluster_hotspots(
        [
            make_detection(1, 95.0, 0.0),
            make_detection(2, 0.0, 181.0),
        ],
        min_count=1,
    )

    assert result["total"] == 0
    assert result["items"] == []


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (90.0, 0.0),
        (-90.0, 0.0),
        (0.0, 180.0),
        (0.0, -180.0),
        (-90.0, -180.0),
        (90.0, 180.0),
    ],
)
def test_coordinates_on_the_range_limits_are_accepted(
    latitude: float,
    longitude: float,
) -> None:
    result = cluster_hotspots(
        [make_detection(1, latitude, longitude)],
        min_count=1,
    )

    assert result["total"] == 1
    assert result["items"][0]["lat"] == latitude
    assert abs(result["items"][0]["lon"]) == abs(longitude)
