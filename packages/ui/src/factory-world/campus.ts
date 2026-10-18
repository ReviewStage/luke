/**
 * campus.ts -- the Factory's campus, everything about it that is not the page: the reading, the layout, and the shapes.
 *
 * The campus draws the world snapshot (`factory-world.ts`) and the tasks the
 * window lists as an isometric town: each task a building lit by its agents,
 * each pull request a container at the merge gate or in the shipped lot, each
 * planned issue a blueprint. `campusReadingOf` reads it, `campusPlanOf` lays
 * it out in a town or in districts of code, and the drawing turns each piece
 * into SVG shapes the window puts on screen as they are. It touches no DOM or
 * React, so a test reads what the page draws.
 */

/** @public The campus's drawing, which the window's scene reads. */
export type {
  BuildingPiece,
  CampusColours,
  CampusDetail,
  CampusDrawing,
  CampusGradient,
  CampusObject,
  CampusShape,
  PieceKind,
  ScreenBounds,
  ShapeMark,
} from "./campus-drawing.js";
export {
  blastShapesOf,
  blueprintShapesOf,
  buildingPiecesOf,
  buildingShadowOf,
  CAMPUS_BIG_FROM,
  CAMPUS_DETAIL,
  CAMPUS_GRADIENT,
  CAMPUS_OBJECT,
  campusBoundsOf,
  campusColoursOf,
  campusDetailOf,
  campusGradientStopsOf,
  campusObjectsOf,
  campusProject,
  campusSeen,
  containerOutlineOf,
  containerShadowOf,
  containerShapesOf,
  craneShapesOf,
  districtAnchorOf,
  districtShapesOf,
  gateShadowOf,
  gateShapesOf,
  groundShapesOf,
  insideShapesOf,
  lampShapesOf,
  laneLampShapesOf,
  lotFlagShapesOf,
  nameAnchorOf,
  outlineOf,
  PIECE,
  plotShapesOf,
  routePointsOf,
  SHAPE_MARK,
  shadowFillOf,
  smokeRationOf,
  treeShadowOf,
  treeShapesOf,
  yardAnchorsOf,
} from "./campus-drawing.js";
/** @public The campus's layout, which the window's scene reads. */
export type {
  CampusDistrict,
  CampusLayout,
  CampusPlan,
  CampusPoint,
  CampusRect,
  CampusSlot,
  PlacedContainer,
} from "./campus-layout.js";
export {
  CAMPUS_LAYOUT,
  CONTAINER,
  campusPlanOf,
  containerLengthOf,
  NOT_IN_CODE,
} from "./campus-layout.js";
/** @public The campus's reading, which the window's scene and chrome read. */
export type {
  CampusContainer,
  CampusReading,
  CampusSignal,
  CampusTask,
  CampusTaskInput,
  GateLane,
} from "./campus-reading.js";
export {
  CAMPUS_SIGNAL,
  CONTAINER_PLACE,
  campusReadingOf,
  GATE_LANE,
  taskBlastRadiusOf,
} from "./campus-reading.js";
