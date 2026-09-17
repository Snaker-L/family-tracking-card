"""Turning a Nominatim answer into one readable line."""

from family_tracking.address import cache_key, parse


class TestParse:
    def test_street_with_house_number(self):
        a = parse({"address": {"road": "Hauptstraße", "house_number": "12", "city": "Wien"}})
        assert a.label == "Hauptstraße 12, Wien"
        assert a.street == "Hauptstraße"
        assert a.house_number == "12"

    def test_street_without_house_number(self):
        a = parse({"address": {"road": "Feldweg", "village": "Kleindorf"}})
        assert a.label == "Feldweg, Kleindorf"

    def test_a_named_place_beats_the_coordinates(self):
        a = parse({"name": "Stadtbibliothek", "address": {"town": "Graz"}})
        assert a.label == "Stadtbibliothek, Graz"

    def test_a_footpath_counts_as_a_street(self):
        a = parse({"address": {"footway": "Uferpromenade", "city": "Linz"}})
        assert a.label == "Uferpromenade, Linz"

    def test_only_a_place_name_is_still_an_answer(self):
        assert parse({"address": {"city": "Salzburg"}}).label == "Salzburg"

    def test_the_place_is_not_repeated(self):
        # Without this the middle of nowhere reads "Salzburg, Salzburg".
        assert parse({"address": {"city": "Salzburg"}}).label == "Salzburg"

    def test_display_name_is_the_last_resort(self):
        a = parse({"display_name": "Irgendwo, Irgendwie, Irgendwann, Österreich"})
        assert a.label == "Irgendwo, Irgendwie"

    def test_nothing_usable_yields_nothing(self):
        assert parse({}).label == ""

    def test_the_parts_are_kept_for_the_sensors(self):
        a = parse(
            {
                "address": {
                    "road": "Ring",
                    "house_number": "1",
                    "city": "Wien",
                    "postcode": "1010",
                    "state": "Wien",
                    "country": "Österreich",
                }
            }
        )
        assert (a.postcode, a.state, a.country) == ("1010", "Wien", "Österreich")


class TestCacheKey:
    def test_nearby_positions_share_a_key(self):
        # Standing still must not produce a new lookup every minute.
        assert cache_key(48.20001, 16.30001) == cache_key(48.20002, 16.30002)

    def test_different_addresses_do_not_collide(self):
        assert cache_key(48.2000, 16.3000) != cache_key(48.2010, 16.3000)
