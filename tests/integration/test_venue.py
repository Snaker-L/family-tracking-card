"""Recognising the place a coordinate is inside, rather than what is nearest."""

from family_tracking.address import merge_venue, parse
from family_tracking.venue import VENUE_TAGS, build_query, pick_name


class TestBuildQuery:
    def test_asks_overpass_what_contains_the_point(self):
        q = build_query(48.2536965, 16.3675578)
        assert q.startswith("[out:json][timeout:25];")
        assert "is_in(48.253696,16.367558)->.a;" in q

    def test_one_request_covers_every_tag(self):
        # Verified against the live service: this is the query that returns
        # "Q19 Einkaufsquartier Döbling" for the coordinate above.
        assert 'area.a["shop"~"^(mall|department_store)$"];out tags;' in build_query(1.0, 2.0)

    def test_tags_of_different_keys_get_their_own_filter(self):
        q = build_query(1.0, 2.0, (("shop", "mall"), ("aeroway", "aerodrome")))
        assert 'area.a["shop"~"^(mall)$"];out tags;' in q
        assert 'area.a["aeroway"~"^(aerodrome)$"];out tags;' in q

    def test_coordinates_are_not_written_in_exponential_form(self):
        # A fix near the prime meridian would otherwise arrive as 1e-07 and the
        # query would be rejected.
        assert "1e-" not in build_query(0.0000001, 0.0000001)

    def test_the_default_list_stays_short(self):
        # Sprawling outlines swallow public streets; see the note in venue.py.
        assert VENUE_TAGS == (("shop", "mall"), ("shop", "department_store"))


class TestPickName:
    def test_takes_the_name_of_the_enclosing_place(self):
        assert pick_name({"elements": [{"tags": {"name": "Stadion Center"}}]}) == "Stadion Center"

    def test_nothing_encloses_the_point(self):
        assert pick_name({"elements": []}) == ""

    def test_missing_elements_is_not_an_error(self):
        assert pick_name({}) == ""

    def test_areas_without_a_name_are_no_answer(self):
        assert pick_name({"elements": [{"tags": {"shop": "mall"}}]}) == ""

    def test_the_smaller_of_two_enclosing_places_wins(self):
        payload = {
            "elements": [
                {"tags": {"name": "Großes Areal", "area": "90000"}},
                {"tags": {"name": "Q19", "area": "12000"}},
            ]
        }
        assert pick_name(payload) == "Q19"

    def test_a_named_hit_beats_one_that_only_has_a_size(self):
        payload = {"elements": [{"tags": {"area": "10"}}, {"tags": {"name": "Q19"}}]}
        assert pick_name(payload) == "Q19"

    def test_an_unreadable_size_does_not_throw_the_answer_away(self):
        payload = {"elements": [{"tags": {"name": "Millennium City", "area": "groß"}}]}
        assert pick_name(payload) == "Millennium City"


class TestMergeVenue:
    def test_the_enclosing_place_replaces_the_street(self):
        a = parse({"address": {"road": "Wagramer Straße", "house_number": "94", "city": "Wien"}})
        assert a.label == "Wagramer Straße 94, Wien"
        merged = merge_venue(a, "Westfield Donau Zentrum")
        assert merged.label == "Westfield Donau Zentrum, Wien"

    def test_it_replaces_a_shop_inside_the_centre(self):
        a = parse({"name": "Nespresso", "address": {"shop": "Nespresso", "city": "Wien"}})
        merged = merge_venue(a, "Q19 Einkaufsquartier Döbling")
        assert merged.label == "Q19 Einkaufsquartier Döbling, Wien"
        assert merged.name == "Q19 Einkaufsquartier Döbling"

    def test_the_address_parts_survive_for_the_sensor(self):
        a = parse({"address": {"road": "Wagramer Straße", "house_number": "94",
                               "postcode": "1220", "city": "Wien"}})
        merged = merge_venue(a, "Westfield Donau Zentrum")
        assert (merged.street, merged.house_number, merged.postcode) == (
            "Wagramer Straße", "94", "1220")

    def test_nothing_encloses_the_fix_and_the_address_stands(self):
        a = parse({"address": {"road": "Hauptstraße", "house_number": "12", "city": "Wien"}})
        assert merge_venue(a, "").label == "Hauptstraße 12, Wien"

    def test_a_place_without_an_address_is_still_an_answer(self):
        merged = merge_venue(None, "Millennium City")
        assert merged.label == "Millennium City"
        assert merged.name == "Millennium City"

    def test_neither_service_answered(self):
        assert merge_venue(None, "") is None

    def test_a_place_without_a_known_city_needs_no_comma(self):
        a = parse({"address": {"road": "Landstraße"}})
        assert merge_venue(a, "Stadion Center").label == "Stadion Center"
