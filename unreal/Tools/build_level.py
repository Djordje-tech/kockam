"""
Builds the sandbox level from scratch, inside the Unreal editor.

Run it from the editor's Python console:

    py Tools/build_level.py

Everything it spawns is tagged, and every run deletes the previous generation
first, so re-running is idempotent — that is what lets it be driven by a file
watcher without the level accumulating duplicate junk.

The level is deliberately built by script rather than by hand. A .umap is an
opaque binary blob that cannot be diffed or merged; this file is the level, in
text, reviewable in a pull request.
"""

import unreal

MAP_PATH = "/Game/Maps/Sandbox"
GENERATED_TAG = "kockam_generated"

FLOOR_SIZE = 40.0          # in 100cm cube units, so 40 = 40m across
PICKUP_COUNT = 24
PICKUP_SPREAD = 1600.0     # centimetres from origin
PICKUP_HEIGHT = 90.0


def _actor_subsystem():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def _level_subsystem():
    return unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def _tag(actor):
    """Marks an actor as ours so the next run can clear it."""
    actor.set_editor_property("tags", [GENERATED_TAG])
    return actor


def _spawn(actor_class, location, rotation=None):
    rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
    actor = _actor_subsystem().spawn_actor_from_class(actor_class, location, rotation)
    return _tag(actor)


def _spawn_mesh(asset_path, location, scale, rotation=None):
    mesh = unreal.EditorAssetLibrary.load_asset(asset_path)
    if mesh is None:
        raise RuntimeError("could not load {}".format(asset_path))

    rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
    actor = _actor_subsystem().spawn_actor_from_object(mesh, location, rotation)
    actor.set_actor_scale3d(scale)
    return _tag(actor)


def clear_generated():
    """Removes everything a previous run of this script created."""
    removed = 0
    for actor in _actor_subsystem().get_all_level_actors():
        if GENERATED_TAG in [str(t) for t in actor.get_editor_property("tags")]:
            _actor_subsystem().destroy_actor(actor)
            removed += 1

    unreal.log("[kockam] cleared {} generated actors".format(removed))


def build_environment():
    # Ground.
    _spawn_mesh(
        "/Engine/BasicShapes/Cube.Cube",
        unreal.Vector(0.0, 0.0, -50.0),
        unreal.Vector(FLOOR_SIZE, FLOOR_SIZE, 1.0),
    )

    # Sky and light. Without these the level renders pitch black.
    _spawn(unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 1000.0),
           unreal.Rotator(-45.0, -35.0, 0.0))
    _spawn(unreal.SkyAtmosphere, unreal.Vector(0.0, 0.0, 0.0))
    _spawn(unreal.SkyLight, unreal.Vector(0.0, 0.0, 500.0))

    # Where the player appears.
    _spawn(unreal.PlayerStart, unreal.Vector(0.0, 0.0, 200.0))


def build_pickups():
    pickup_class = unreal.load_class(None, "/Script/Kockam.PickupActor")
    if pickup_class is None:
        unreal.log_warning(
            "[kockam] PickupActor not found - compile the C++ first, then re-run")
        return

    import math
    import random

    for index in range(PICKUP_COUNT):
        # Even angular spacing with a jittered radius keeps them spread out
        # instead of clumping the way pure random placement does.
        angle = (index / float(PICKUP_COUNT)) * math.tau
        radius = PICKUP_SPREAD * math.sqrt(random.uniform(0.15, 1.0))

        _spawn(
            pickup_class,
            unreal.Vector(
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                PICKUP_HEIGHT,
            ),
        )


def main():
    level = _level_subsystem()

    if not unreal.EditorAssetLibrary.does_asset_exist(MAP_PATH):
        unreal.log("[kockam] creating {}".format(MAP_PATH))
        level.new_level(MAP_PATH)
    elif unreal.EditorAssetLibrary.get_path_name_for_loaded_asset(
            unreal.EditorLevelLibrary.get_editor_world()) != MAP_PATH:
        level.load_level(MAP_PATH)

    clear_generated()
    build_environment()
    build_pickups()

    level.save_current_level()
    unreal.log("[kockam] level rebuilt")


main()
