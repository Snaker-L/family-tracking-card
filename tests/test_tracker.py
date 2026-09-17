"""The rules that decide which tracker moves a person."""

from family_tracking.tracker import (
    Fix,
    compass_point,
    direction_of_travel,
    judge,
    presence_of,
)


def fix(source="device_tracker.phone", at=1000.0, accuracy=20.0, zone="not_home", lat=48.2, lon=16.3):
    return Fix(source=source, latitude=lat, longitude=lon, at=at, accuracy=accuracy, zone=zone)


class TestJudge:
    def test_first_fix_is_always_taken(self):
        assert judge(fix(), None).accept

    def test_zero_accuracy_is_refused(self):
        # Several trackers report 0 when they have no fix at all, which reads as
        # a perfect one if taken at face value.
        assert not judge(fix(accuracy=0), None).accept
        assert judge(fix(accuracy=0), None).reason == "accuracy-zero"

    def test_poor_accuracy_is_refused(self):
        assert not judge(fix(accuracy=500), fix()).accept
        assert judge(fix(accuracy=500), fix(), max_accuracy=1000).accept

    def test_a_report_older_than_what_we_have_is_dropped(self):
        assert not judge(fix(at=500), fix(at=1000)).accept
        assert judge(fix(at=500), fix(at=1000)).reason == "stale"

    def test_a_zone_change_wins_regardless_of_accuracy(self):
        current = fix(source="device_tracker.phone", accuracy=5)
        crossing = fix(source="device_tracker.router", accuracy=90, zone="home")
        assert judge(crossing, current).accept
        assert judge(crossing, current).reason == "zone-change"

    def test_the_tracker_being_followed_keeps_the_lead(self):
        current = fix(source="device_tracker.phone", accuracy=10)
        later = fix(source="device_tracker.phone", accuracy=80, at=2000)
        assert judge(later, current).accept
        assert judge(later, current).reason == "same-source"

    def test_another_tracker_needs_to_be_better(self):
        current = fix(source="device_tracker.phone", accuracy=10)
        worse = fix(source="device_tracker.watch", accuracy=60, at=2000)
        better = fix(source="device_tracker.watch", accuracy=5, at=2000)
        assert not judge(worse, current).accept
        assert judge(better, current).accept

    def test_a_known_accuracy_beats_an_unknown_one(self):
        current = fix(source="device_tracker.phone", accuracy=None)
        known = fix(source="device_tracker.watch", accuracy=40, at=2000)
        assert judge(known, current).accept


class TestPresence:
    def test_arriving_and_leaving_get_their_own_state(self):
        assert presence_of("home", "not_home", 10) == "just_arrived"
        assert presence_of("not_home", "home", 10) == "just_left"

    def test_the_transition_wears_off(self):
        assert presence_of("home", "not_home", 10_000) == "home"
        assert presence_of("not_home", "home", 10_000) == "away"

    def test_staying_put_is_not_a_transition(self):
        assert presence_of("home", "home", 10) == "home"
        assert presence_of("not_home", "not_home", 10) == "away"

    def test_without_a_position_it_says_so(self):
        assert presence_of("unknown", "home", 10) == "unknown"
        assert presence_of("", None, 10) == "unknown"


class TestDirection:
    def test_getting_closer_and_further(self):
        assert direction_of_travel(1000, 2000) == "towards home"
        assert direction_of_travel(2000, 1000) == "away from home"

    def test_jitter_does_not_count_as_movement(self):
        # A stationary phone wanders by a few metres; that is not a journey.
        assert direction_of_travel(1000, 1010) == "stationary"

    def test_the_first_reading_has_nothing_to_compare_to(self):
        assert direction_of_travel(1000, None) == "stationary"

    def test_compass_points(self):
        assert compass_point(0) == "N"
        assert compass_point(90) == "E"
        assert compass_point(181) == "S"
        assert compass_point(315) == "NW"

class TestDirectionIsOnlyMovement:
    """The two questions must stay apart: how someone moves, and where they are.

    Mixing them put a compass point into `direction` whenever no movement was
    detected, so a person standing at home read "SE" -- true as a bearing,
    meaningless as a direction of travel, and impossible to tell apart.
    """

    def test_movement_never_returns_a_compass_point(self):
        bewegungen = {"towards home", "away from home", "stationary"}
        for jetzt, vorher in [(1000, 2000), (2000, 1000), (1000, 1010), (1000, None), (0, 0)]:
            assert direction_of_travel(jetzt, vorher) in bewegungen

    def test_the_compass_stays_a_compass(self):
        assert compass_point(135) == "SE"
        assert compass_point(135) not in {"towards home", "away from home", "stationary"}
