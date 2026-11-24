/**
 * Built-in themed word lists: family-friendly, 25 words each, every word
 * 3–12 letters so it fits even the 13 × 13 extra-large-print grid.
 * 51 themes means a 100-puzzle book uses each theme about twice, and the
 * theme decks avoid repeating words until a theme runs out.
 */

export interface LibraryTheme {
  title: string;
  category: string;
  words: string;
}

export const THEME_LIBRARY: readonly LibraryTheme[] = [
  // Animals
  { category: "Animals", title: "Ocean Life", words: "dolphin, whale, shark, octopus, coral, starfish, seahorse, jellyfish, lobster, crab, turtle, squid, oyster, clam, seaweed, anemone, plankton, stingray, walrus, orca, barnacle, mussel, shrimp, urchin, pelican" },
  { category: "Animals", title: "Farm Animals", words: "cow, pig, sheep, goat, horse, chicken, rooster, duck, goose, turkey, donkey, llama, alpaca, rabbit, calf, lamb, piglet, foal, kid, hen, chick, oxen, mule, bull, pony" },
  { category: "Animals", title: "Birds", words: "robin, sparrow, eagle, hawk, falcon, owl, parrot, pigeon, crow, raven, swallow, finch, wren, heron, crane, stork, flamingo, penguin, puffin, toucan, peacock, cardinal, bluejay, magpie, hummingbird" },
  { category: "Animals", title: "Safari", words: "lion, tiger, elephant, giraffe, zebra, rhino, hippo, cheetah, leopard, gorilla, monkey, baboon, hyena, jackal, gazelle, antelope, buffalo, warthog, meerkat, ostrich, vulture, crocodile, wildebeest, impala, savanna" },
  { category: "Animals", title: "Pets", words: "puppy, kitten, hamster, goldfish, parakeet, guinea pig, rabbit, ferret, turtle, gecko, canary, collar, leash, kennel, catnip, treat, whiskers, paws, tail, fetch, groom, vet, bowl, cage, aquarium" },
  { category: "Animals", title: "Insects & Bugs", words: "ant, bee, wasp, beetle, ladybug, butterfly, moth, dragonfly, cricket, grasshopper, firefly, termite, mosquito, flea, caterpillar, cocoon, larva, antenna, hive, honey, spider, web, mantis, cicada, aphid" },
  { category: "Animals", title: "Dogs", words: "beagle, poodle, boxer, collie, husky, terrier, spaniel, retriever, dalmatian, bulldog, greyhound, labrador, pug, corgi, chihuahua, shepherd, mastiff, whippet, schnauzer, setter, pointer, bark, wag, bone, puppy" },
  { category: "Animals", title: "Woodland", words: "deer, fox, bear, wolf, badger, raccoon, squirrel, chipmunk, beaver, otter, skunk, moose, elk, owl, hedgehog, porcupine, rabbit, mole, woodpecker, acorn, pinecone, burrow, den, antler, forest" },

  // Food & Drink
  { category: "Food & Drink", title: "Fruits", words: "apple, banana, cherry, grape, mango, peach, pear, plum, kiwi, lemon, lime, orange, papaya, guava, melon, apricot, coconut, fig, date, raspberry, blueberry, strawberry, pineapple, nectarine, tangerine" },
  { category: "Food & Drink", title: "Vegetables", words: "carrot, potato, tomato, onion, garlic, pepper, lettuce, spinach, cabbage, broccoli, celery, cucumber, zucchini, pumpkin, squash, radish, turnip, beet, pea, bean, corn, kale, leek, asparagus, artichoke" },
  { category: "Food & Drink", title: "Baking", words: "flour, sugar, butter, eggs, yeast, dough, oven, whisk, mixer, bowl, rolling pin, muffin, cookie, cake, pie, bread, scone, icing, frosting, sprinkles, vanilla, cinnamon, recipe, apron, timer" },
  { category: "Food & Drink", title: "Breakfast", words: "pancakes, waffles, toast, bacon, eggs, omelet, cereal, oatmeal, yogurt, granola, muffin, bagel, croissant, syrup, butter, jam, honey, juice, coffee, tea, milk, fruit, sausage, hash browns, porridge" },
  { category: "Food & Drink", title: "Desserts", words: "cake, pie, cookie, brownie, pudding, custard, sundae, gelato, sorbet, cupcake, donut, eclair, fudge, toffee, caramel, meringue, trifle, cobbler, tart, mousse, cheesecake, cannoli, macaron, truffle, candy" },
  { category: "Food & Drink", title: "Around the World Food", words: "pizza, pasta, sushi, tacos, curry, paella, noodles, dumpling, burrito, kebab, falafel, hummus, risotto, ramen, tapas, croissant, pretzel, goulash, lasagna, ravioli, tortilla, samosa, baguette, gyro, crepe" },
  { category: "Food & Drink", title: "Herbs & Spices", words: "basil, oregano, thyme, rosemary, sage, parsley, mint, dill, chives, cilantro, cumin, paprika, ginger, nutmeg, cinnamon, clove, saffron, turmeric, pepper, vanilla, fennel, mustard, garlic, chili, cardamom" },

  // Nature
  { category: "Nature", title: "Garden", words: "flower, rose, tulip, daisy, lily, orchid, shovel, rake, seeds, soil, compost, hose, watering, sunflower, bloom, petal, stem, leaf, root, weed, hedge, trowel, greenhouse, butterfly, ladybug" },
  { category: "Nature", title: "Trees", words: "oak, maple, pine, birch, willow, cedar, spruce, elm, ash, beech, cherry, palm, redwood, sequoia, cypress, poplar, aspen, magnolia, chestnut, walnut, sycamore, hickory, bark, branch, acorn" },
  { category: "Nature", title: "Weather", words: "sunny, cloudy, rain, storm, thunder, lightning, snow, sleet, hail, wind, breeze, fog, mist, drizzle, rainbow, frost, humid, tornado, hurricane, blizzard, forecast, climate, monsoon, drought, heatwave" },
  { category: "Nature", title: "Flowers", words: "rose, tulip, daisy, lily, orchid, daffodil, iris, peony, violet, lilac, poppy, lavender, jasmine, marigold, carnation, dahlia, zinnia, aster, begonia, petunia, pansy, hibiscus, lotus, bluebell, primrose" },
  { category: "Nature", title: "Mountains", words: "summit, peak, ridge, valley, glacier, cliff, canyon, slope, trail, hiking, climber, rope, boulder, avalanche, altitude, alpine, meadow, cave, waterfall, pass, plateau, crest, volcano, snowcap, basecamp" },
  { category: "Nature", title: "Rivers & Lakes", words: "river, stream, creek, brook, lake, pond, delta, rapids, current, waterfall, dam, bank, shore, canoe, kayak, paddle, fishing, trout, salmon, reeds, lily pad, frog, heron, bridge, estuary" },
  { category: "Nature", title: "Seasons", words: "spring, summer, autumn, winter, blossom, harvest, snowflake, sunshine, leaves, frost, equinox, solstice, planting, picnic, sweater, mittens, scarf, rain boots, heat, chill, thaw, bloom, pumpkin, sledding, beach" },
  { category: "Nature", title: "Beach", words: "sand, waves, shells, ocean, tide, surf, sunscreen, towel, umbrella, bucket, spade, sandcastle, seagull, pier, lighthouse, dunes, coast, swimsuit, flipflops, cooler, snorkel, boardwalk, driftwood, lifeguard, sunset" },

  // Home & Life
  { category: "Home & Life", title: "Kitchen", words: "spoon, fork, knife, plate, bowl, oven, stove, kettle, toaster, blender, whisk, ladle, spatula, colander, skillet, saucepan, cupboard, napkin, apron, mixer, grater, peeler, teapot, mug, pantry" },
  { category: "Home & Life", title: "Around the House", words: "kitchen, bedroom, bathroom, attic, basement, garage, hallway, staircase, window, door, roof, chimney, porch, garden, fence, closet, pantry, laundry, study, nursery, balcony, patio, lamp, sofa, carpet" },
  { category: "Home & Life", title: "Furniture", words: "chair, table, sofa, couch, bed, dresser, wardrobe, bookcase, desk, stool, bench, cabinet, ottoman, recliner, armchair, nightstand, mirror, lamp, rug, shelf, crib, cupboard, futon, hammock, rocker" },
  { category: "Home & Life", title: "Clothing", words: "shirt, blouse, sweater, jacket, coat, dress, skirt, trousers, jeans, shorts, socks, shoes, boots, sandals, hat, scarf, gloves, mittens, belt, tie, vest, pajamas, apron, cardigan, raincoat" },
  { category: "Home & Life", title: "Family", words: "mother, father, sister, brother, grandma, grandpa, aunt, uncle, cousin, niece, nephew, daughter, son, baby, twins, parents, relatives, reunion, wedding, ancestor, heritage, family tree, home, love, together" },
  { category: "Home & Life", title: "School Days", words: "teacher, student, pencil, eraser, notebook, crayon, ruler, backpack, lunchbox, recess, library, homework, lesson, desk, chalk, globe, science, history, spelling, math, reading, art, music, bus, principal" },
  { category: "Home & Life", title: "Tools", words: "hammer, nail, screw, drill, saw, wrench, pliers, chisel, level, tape measure, sander, clamp, vise, toolbox, ladder, glue, sandpaper, file, bolt, nut, washer, crowbar, mallet, axe, shovel" },

  // Travel & Places
  { category: "Travel & Places", title: "Travel", words: "passport, luggage, ticket, airport, train, cruise, hotel, beach, mountain, camera, map, compass, journey, tourist, suitcase, vacation, island, souvenir, museum, adventure, backpack, highway, ferry, safari, voyage" },
  { category: "Travel & Places", title: "Countries", words: "canada, mexico, brazil, peru, chile, france, spain, italy, germany, ireland, norway, sweden, greece, egypt, kenya, india, china, japan, korea, vietnam, thailand, australia, iceland, portugal, morocco" },
  { category: "Travel & Places", title: "US States", words: "alabama, alaska, arizona, colorado, delaware, florida, georgia, hawaii, idaho, iowa, kansas, kentucky, maine, maryland, michigan, montana, nevada, ohio, oregon, texas, utah, vermont, virginia, wyoming, nebraska" },
  { category: "Travel & Places", title: "Capital Cities", words: "london, paris, rome, madrid, berlin, vienna, dublin, oslo, athens, cairo, nairobi, tokyo, seoul, beijing, delhi, bangkok, canberra, ottawa, lima, santiago, havana, lisbon, prague, warsaw, helsinki" },
  { category: "Travel & Places", title: "Camping", words: "tent, campfire, sleeping bag, lantern, flashlight, compass, hiking, trail, canoe, marshmallow, smores, firewood, cooler, backpack, map, stars, forest, lake, fishing, cabin, ranger, trailhead, pinecone, owl, wilderness" },
  { category: "Travel & Places", title: "Transportation", words: "car, bus, train, plane, boat, ship, bicycle, scooter, truck, taxi, subway, tram, ferry, helicopter, rocket, van, tractor, canoe, kayak, sailboat, motorcycle, skateboard, wagon, jet, trolley" },
  { category: "Travel & Places", title: "Around Town", words: "bakery, bank, library, school, hospital, museum, park, post office, market, cafe, pharmacy, theater, station, church, police, fire station, hotel, bridge, street, avenue, square, fountain, mall, stadium, zoo" },

  // Holidays & Celebrations
  { category: "Holidays", title: "Christmas", words: "santa, reindeer, sleigh, stocking, ornament, tinsel, wreath, candy cane, snowman, presents, chimney, carols, angel, star, holly, mistletoe, eggnog, gingerbread, elves, bells, lights, nutcracker, cookies, fireplace, tree" },
  { category: "Holidays", title: "Thanksgiving", words: "turkey, stuffing, gravy, cranberry, pumpkin pie, harvest, pilgrim, feast, family, grateful, thankful, cornucopia, potatoes, casserole, autumn, leaves, parade, football, gather, blessing, rolls, yams, squash, corn, pecan" },
  { category: "Holidays", title: "Halloween", words: "pumpkin, costume, candy, ghost, witch, broom, cauldron, spider, web, bat, moon, lantern, haunted, skeleton, mask, cape, owl, black cat, trick, treat, jack o lantern, potion, spooky, scarecrow, harvest" },
  { category: "Holidays", title: "Easter & Spring", words: "bunny, eggs, basket, chicks, lamb, tulip, daffodil, lily, bonnet, parade, chocolate, jellybean, hunt, pastel, sunrise, blossom, spring, grass, bloom, meadow, butterfly, rainbow, picnic, garden, robin" },
  { category: "Holidays", title: "Birthday Party", words: "cake, candles, balloons, presents, wrapping, ribbon, party hat, streamers, confetti, games, friends, cupcakes, ice cream, card, wish, celebrate, guests, music, dance, piñata, cheer, surprise, banner, gifts, invite" },
  { category: "Holidays", title: "Wedding", words: "bride, groom, ring, vows, veil, bouquet, cake, dance, toast, guests, ceremony, reception, chapel, flowers, tuxedo, gown, music, rice, honeymoon, love, kiss, aisle, usher, photos, promise" },

  // Sports & Hobbies
  { category: "Sports & Hobbies", title: "Sports", words: "soccer, football, baseball, basketball, tennis, golf, hockey, rugby, cricket, volleyball, swimming, boxing, cycling, skiing, surfing, rowing, archery, fencing, karate, judo, bowling, running, skating, diving, polo" },
  { category: "Sports & Hobbies", title: "Crafts", words: "knitting, crochet, sewing, quilting, painting, drawing, pottery, weaving, beading, scrapbook, origami, embroidery, yarn, needle, thread, fabric, canvas, brush, glue, scissors, paper, clay, glitter, stencil, easel" },
  { category: "Sports & Hobbies", title: "Music", words: "piano, guitar, violin, cello, drums, flute, trumpet, saxophone, harp, banjo, ukulele, clarinet, tuba, melody, rhythm, harmony, chord, tempo, concert, choir, orchestra, singer, lyrics, note, song" },
  { category: "Sports & Hobbies", title: "Games", words: "chess, checkers, dominoes, puzzle, cards, dice, bingo, marbles, jigsaw, crossword, riddle, tag, hopscotch, kite, yoyo, solitaire, poker, trivia, charades, scrabble, darts, bowling, croquet, frisbee, board" },
  { category: "Sports & Hobbies", title: "Reading Nook", words: "book, novel, story, author, chapter, page, library, poem, fiction, mystery, fable, legend, fairy tale, hero, plot, bookmark, cover, spine, shelf, reader, ending, tale, myth, adventure, prologue" },

  // Science & Space
  { category: "Science & Space", title: "Outer Space", words: "planet, star, moon, comet, galaxy, nebula, asteroid, meteor, orbit, rocket, astronaut, satellite, telescope, mercury, venus, earth, mars, jupiter, saturn, uranus, neptune, eclipse, gravity, cosmos, universe" },
  { category: "Science & Space", title: "Science Lab", words: "atom, molecule, beaker, test tube, microscope, magnet, energy, gravity, experiment, theory, element, oxygen, carbon, hydrogen, physics, chemistry, biology, laser, fossil, cell, gene, crystal, formula, data, lab coat" },
  { category: "Science & Space", title: "Dinosaurs", words: "fossil, raptor, triceratops, stegosaurus, brontosaurus, pterodactyl, jurassic, cretaceous, extinct, claw, tail, egg, nest, herbivore, carnivore, meteor, skeleton, bones, museum, swamp, roar, scales, horns, giant, dig" },
];

export const LIBRARY_CATEGORIES = [...new Set(THEME_LIBRARY.map((t) => t.category))];

/** The library (or a subset of it) in the `# Title` text format the parser reads. */
export function libraryToText(titles?: ReadonlySet<string>): string {
  return THEME_LIBRARY.filter((t) => !titles || titles.has(t.title))
    .map((t) => `# ${t.title}\n${t.words}`)
    .join("\n");
}
