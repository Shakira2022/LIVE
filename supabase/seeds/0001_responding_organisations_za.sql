-- ---------------------------------------------------------------------------
-- DEMO SEED: responding organisations with coordinates
-- Block 4 (Person 4) / Block 8 (Person 9 - test accounts and seeds)
--
-- WHY YOU NEED THIS
--   Nearest-organisation routing can only pick from organisations that are
--   (a) status 'active', (b) of type 'hospital' or 'emergency_response', and
--   (c) have latitude and longitude set. Until this runs, that set is EMPTY,
--   so every request is created unrouted and routingReason = 'no_candidates'.
--
-- >> THE COORDINATES BELOW ARE APPROXIMATE AND FOR DEMONSTRATION ONLY. <<
--   They are good to roughly the right suburb - enough to prove that routing
--   picks a Cape Town hospital for a Cape Town incident rather than a
--   Johannesburg one. They are NOT survey-accurate and must NOT be relied on
--   to dispatch a real vehicle. Before this is anything other than a
--   prototype, replace every row with verified data from the responding
--   organisations themselves. That is a cross-team item for Person 4.
--
-- Safe to re-run: each insert is skipped if an organisation of that name
-- already exists. Nothing is updated or deleted.
-- ---------------------------------------------------------------------------

insert into organisations
  (name, organisation_type, service_area_description, status,
   city, province, country_code, latitude, longitude, contact_phone)
select v.name, v.organisation_type::organisation_type, v.service_area,
       'active'::organisation_status,
       v.city, v.province, 'ZA', v.latitude, v.longitude, v.phone
from (values
  -- Gauteng
  ('Charlotte Maxeke Johannesburg Academic Hospital', 'hospital',
   'Johannesburg central and surrounding suburbs',
   'Johannesburg', 'Gauteng', -26.1875, 28.0450, '+27114883000'),
  ('Chris Hani Baragwanath Academic Hospital', 'hospital',
   'Soweto and south-western Johannesburg',
   'Johannesburg', 'Gauteng', -26.2608, 27.9394, '+27119330000'),
  ('Steve Biko Academic Hospital', 'hospital',
   'Tshwane metropolitan area',
   'Pretoria', 'Gauteng', -25.7280, 28.2000, '+27123541000'),
  ('Gauteng Emergency Medical Services', 'emergency_response',
   'Province-wide ambulance and rescue response',
   'Johannesburg', 'Gauteng', -26.2041, 28.0473, '+27112411000'),

  -- Western Cape
  ('Groote Schuur Hospital', 'hospital',
   'Cape Town metropolitan area',
   'Cape Town', 'Western Cape', -33.9410, 18.4650, '+27214049111'),
  ('Tygerberg Hospital', 'hospital',
   'Northern suburbs of Cape Town and Cape Winelands',
   'Cape Town', 'Western Cape', -33.9200, 18.6100, '+27219385100'),
  ('Western Cape Emergency Medical Services', 'emergency_response',
   'Province-wide ambulance and rescue response',
   'Cape Town', 'Western Cape', -33.9249, 18.4241, '+27214839700'),

  -- KwaZulu-Natal
  ('Inkosi Albert Luthuli Central Hospital', 'hospital',
   'eThekwini and central KwaZulu-Natal',
   'Durban', 'KwaZulu-Natal', -29.8500, 30.9800, '+27312401000'),
  ('Addington Hospital', 'hospital',
   'Durban central and beachfront',
   'Durban', 'KwaZulu-Natal', -29.8680, 31.0300, '+27313273000'),

  -- Eastern Cape
  ('Livingstone Tertiary Hospital', 'hospital',
   'Nelson Mandela Bay metropolitan area',
   'Gqeberha', 'Eastern Cape', -33.9300, 25.5800, '+27414053911'),
  ('Nelson Mandela Academic Hospital', 'hospital',
   'OR Tambo district and surrounds',
   'Mthatha', 'Eastern Cape', -31.5900, 28.7800, '+27475024000'),

  -- Free State
  ('Universitas Academic Hospital', 'hospital',
   'Mangaung and central Free State',
   'Bloemfontein', 'Free State', -29.1100, 26.1900, '+27514053911'),

  -- Mpumalanga, Limpopo, Northern Cape, North West
  ('Rob Ferreira Hospital', 'hospital',
   'Ehlanzeni district and Lowveld',
   'Mbombela', 'Mpumalanga', -25.4700, 30.9700, '+27137413000'),
  ('Polokwane Provincial Hospital', 'hospital',
   'Capricorn district and surrounds',
   'Polokwane', 'Limpopo', -23.9000, 29.4500, '+27152873000'),
  ('Robert Mangaliso Sobukwe Hospital', 'hospital',
   'Frances Baard district and surrounds',
   'Kimberley', 'Northern Cape', -28.7400, 24.7600, '+27538022111'),
  ('Job Shimankana Tabane Hospital', 'hospital',
   'Bojanala district and surrounds',
   'Rustenburg', 'North West', -25.6700, 27.2400, '+27145907000')
) as v(name, organisation_type, service_area, city, province, latitude, longitude, phone)
where not exists (
  select 1 from organisations o where o.name = v.name
);

-- ---------------------------------------------------------------------------
-- Verify: every row here is a candidate the router can choose.
-- If this returns 0 rows, routing will always report 'no_candidates'.
-- ---------------------------------------------------------------------------
-- select name, organisation_type, city, latitude, longitude
-- from organisations
-- where status = 'active'
--   and organisation_type in ('hospital', 'emergency_response')
--   and latitude is not null
--   and longitude is not null
-- order by province, name;
