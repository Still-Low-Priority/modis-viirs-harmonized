import { describe, expect, it } from 'vitest'
import {
  bboxOutlineRings,
  bboxToLatLngs,
  boundsToBbox,
  cellForZoom,
  darken,
  heatT,
  metersPerPixel,
  multiPolygonToLines,
  ringRadiusMeters,
  ringRadiusPx,
  wrapLon,
} from './geo'

describe('map geo helpers', () => {
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170)
    expect(wrapLon(-190)).toBe(170)
    expect(wrapLon(30)).toBe(30)
  })

  it('clamps latitude and keeps normal views', () => {
    expect(boundsToBbox(-10, -90, 20, 89)).toEqual([-10, -85, 20, 85])
  })

  it('returns the whole world when the span is >= 360', () => {
    expect(boundsToBbox(-200, -10, 200, 10)).toEqual([-180, -10, 180, 10])
  })

  it('normalises world copies and antimeridian crossings', () => {
    expect(boundsToBbox(350, 0, 370, 10)).toEqual([-10, 0, 10, 10])
    expect(boundsToBbox(170, 0, 190, 10)).toEqual([170, 0, -170, 10])
    expect(boundsToBbox(-190, 0, -170, 10)).toEqual([170, 0, -170, 10])
    expect(boundsToBbox(100, 0, 180, 10)).toEqual([100, 0, 180, 10])
  })

  it('unwraps antimeridian boxes for Leaflet', () => {
    expect(bboxToLatLngs([170, 0, -170, 10])).toEqual([
      [0, 170],
      [10, 190],
    ])
  })

  it('picks coarser cells when zoomed out', () => {
    expect(cellForZoom(2)).toBe(2)
    expect(cellForZoom(4)).toBe(1)
    expect(cellForZoom(9)).toBe(0.1)
  })

  it('normalises heat and darkens colours', () => {
    expect(heatT(0, 10)).toBe(0)
    expect(heatT(10, 10)).toBe(1)
    expect(darken('#ffffff', 0.5)).toBe('#808080')
  })

  it('computes metres per pixel', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1)
    expect(metersPerPixel(0, 1)).toBeCloseTo(78271.52, 1)
    expect(metersPerPixel(60, 0)).toBeCloseTo(78271.52, 1)
  })

  it('keeps hotspot rings at least minPx on screen', () => {
    // Zoomed in: the real radius wins.
    expect(ringRadiusMeters(10, 0, 10)).toBe(10_000)
    // Zoomed out: 10 km is ~0.06 px at zoom 2, so the minimum wins.
    const r = ringRadiusMeters(10, 0, 2)
    expect(r).toBeGreaterThan(10_000)
    expect(ringRadiusPx(r, 0, 2)).toBeCloseTo(10, 6)
    expect(ringRadiusPx(ringRadiusMeters(1, 45, 3, 14), 45, 3)).toBeCloseTo(14, 6)
  })

  it('outlines normal bboxes with one closed ring', () => {
    expect(bboxOutlineRings([10, 20, 30, 40])).toEqual([
      [
        [20, 10],
        [40, 10],
        [40, 30],
        [20, 30],
        [20, 10],
      ],
    ])
  })

  it('unwraps antimeridian bboxes and adds a copy west of the seam', () => {
    const rings = bboxOutlineRings([170, -20, -170, -10])
    expect(rings).toHaveLength(2)
    expect(rings[0].map((p) => p[1])).toEqual([170, 170, 190, 190, 170])
    expect(rings[1].map((p) => p[1])).toEqual([-190, -190, -170, -170, -190])
  })

  it('converts [lon, lat] polygons to [lat, lon] lines', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
      [0, 0],
    ]
    expect(multiPolygonToLines([[square]])).toEqual([
      [
        [0, 0],
        [0, 10],
        [5, 10],
        [5, 0],
        [0, 0],
      ],
    ])
  })

  it('drops polygon edges that run along the antimeridian', () => {
    const east: [number, number][] = [
      [170, 60],
      [180, 60],
      [180, 70],
      [170, 70],
      [170, 60],
    ]
    expect(multiPolygonToLines([[east]])).toEqual([
      [
        [60, 170],
        [60, 180],
      ],
      [
        [70, 180],
        [70, 170],
        [60, 170],
      ],
    ])
  })
})
