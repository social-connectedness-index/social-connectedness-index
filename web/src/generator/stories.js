// Example Map Maker stories. Each story is narrative copy plus a config object
// accepted by generator.js's applyConfig/window.SCI.generate path.

function usCountyStory({
  id,
  title,
  setup,
  body,
  source,
  sourceName,
  mapTitle,
  subtitle,
  readPattern,
  refq = 0.25,
  extraSteps = [],
}) {
  return {
    id,
    title,
    setup,
    body,
    config: {
      mode: "single",
      origin: "us_county",
      dest: "us_county",
      source,
      palette: "Blue (default)",
      refMode: "quantile",
      refq,
      breakScheme: "quantile",
      borders: true,
      highlight: true,
      title: mapTitle,
      subtitle,
    },
    steps: [
      {
        title: "Choose the home-region level",
        body: "Under Friendships to, set Region type to US County. This tells the Map Maker that the source place will be a county.",
        targets: ["#originType"],
        config: { origin: "us_county" },
      },
      {
        title: `Find ${sourceName}`,
        body: `Search for ${sourceName}, then select it from the county list. This is the county whose friendships the map will measure.`,
        targets: ["#searchA", "#sourceA"],
        config: { origin: "us_county", source },
        searchA: sourceName,
      },
      {
        title: "Choose what the map colors",
        body: `Under Shown across, set Region type to US County. The map will color every U.S. county by its connectedness to ${sourceName}.`,
        targets: ["#destType"],
        config: { origin: "us_county", dest: "us_county", source },
      },
      ...extraSteps,
      {
        title: "Generate the county map",
        body: "Now generate the map. The example fills in the title and subtitle, then renders the same map you could make manually.",
        targets: ["#generate"],
        config: "full",
        generate: true,
      },
      {
        title: "Read the pattern",
        body: readPattern,
        targets: ["#mapWrap"],
      },
    ],
  };
}

function portugalAfricaStory() {
  const finalConfig = {
    mode: "single",
    origin: "country",
    dest: "gadm2",
    source: "PT",
    regions: "Africa",
    palette: "Blue (default)",
    refMode: "quantile",
    refq: 0.25,
    breakScheme: "quantile",
    borders: true,
    highlight: false,
    title: "Portugal's Connections to African Regions",
    subtitle: "Connections from Portugal to regions in Africa",
  };
  const highlightedConfig = { ...finalConfig, highlight: true };

  return {
    id: "portugal-africa-colonial-ties",
    title: "Portuguese Colonization in Africa",
    setup: "Portugal -> regions in Africa",
    body:
      "Portugal's history of colonization in parts of Africa still shows up in today's connections. Regions in Angola, Mozambique, Guinea-Bissau, Cape Verde, and São Tomé and Príncipe stand out as strongly connected to Portugal.",
    config: finalConfig,
    steps: [
      {
        title: "Choose Country as the home level",
        body: "Under Friendships to, set Region type to Country. This tells the Map Maker that the source place will be a country.",
        targets: ["#originType"],
        config: { origin: "country" },
      },
      {
        title: "Find Portugal",
        body: "Search for Portugal, then select it from the country list. This is the country whose friendships the map will measure.",
        targets: ["#searchA", "#sourceA"],
        config: { origin: "country", source: "PT" },
        searchA: "Portugal",
      },
      {
        title: "Show regional detail",
        body: "Under Shown across, set Region type to Region. The map will color subnational regions rather than whole countries.",
        targets: ["#destType"],
        config: { origin: "country", dest: "gadm2", source: "PT" },
      },
      {
        title: "Limit the map to Africa",
        body:
          "In Regions to show, choose Africa. You could choose a different world region here, combine multiple region groups, or add individual countries if you wanted a more specific map.",
        targets: ["#countryWrap"],
        config: { origin: "country", dest: "gadm2", source: "PT", regions: "Africa" },
      },
      {
        title: "See the default home-region highlight",
        body:
          "With Color home region left on, Portugal is drawn in red. Because this map is focused on African regions, that red highlight can feel distracting.",
        targets: ["#mapWrap"],
        config: highlightedConfig,
        generate: true,
        final: false,
      },
      {
        title: "Turn off Color home region",
        body:
          "Open Advanced options and turn Color home region off. This keeps the focus on the African regions being compared rather than marking Portugal in red.",
        targets: ["#highlightWrap"],
        config: finalConfig,
        openAdvanced: true,
        generate: true,
      },
      {
        title: "Read the pattern",
        body:
          "The strongest African regional connections to Portugal cluster around former Portuguese colonies, especially Angola, Mozambique, Guinea-Bissau, Cape Verde, and São Tomé and Príncipe.",
        targets: ["#mapWrap"],
      },
    ],
  };
}

function dominicanRepublicNycZipStory() {
  const finalConfig = {
    mode: "single",
    origin: "country",
    dest: "us_zcta",
    source: "DO",
    metro: "NYC",
    palette: "Blue (default)",
    refMode: "quantile",
    refq: 0.25,
    breakScheme: "quantile",
    borders: true,
    highlight: true,
    title: "Dominican Republic Connections in New York City",
    subtitle: "Connections from the Dominican Republic to NYC ZIP codes",
  };

  return {
    id: "dominican-republic-nyc-diaspora",
    title: "Dominican Migration to New York City",
    setup: "Dominican Republic -> NYC ZIP codes",
    body:
      "Large-scale Dominican migration to New York City accelerated after the fall of Rafael Trujillo in 1961, with migrants drawn by economic opportunities and existing family networks. Washington Heights, Inwood, and much of the Bronx became major centers of Dominican life, creating dense communities that reinforced further migration. Today, hundreds of thousands of Dominicans and Dominican Americans live in NYC, maintaining strong connections to the Dominican Republic.",
    config: finalConfig,
    steps: [
      {
        title: "Choose Country as the home level",
        body: "Under Friendships to, set Region type to Country. This tells the Map Maker that the source place will be a country.",
        targets: ["#originType"],
        config: { origin: "country" },
      },
      {
        title: "Find the Dominican Republic",
        body: "Search for Dominican Republic, then select it from the country list. This is the country whose friendships the map will measure.",
        targets: ["#searchA", "#sourceA"],
        config: { origin: "country", source: "DO" },
        searchA: "Dominican Republic",
      },
      {
        title: "Show ZIP-code detail",
        body: "Under Shown across, set Region type to US ZIP Code. This lets the map show within-city variation at a much finer geography than counties.",
        targets: ["#destType"],
        config: { origin: "country", dest: "us_zcta", source: "DO" },
      },
      {
        title: "Limit ZIP codes to New York City",
        body:
          "Use the Metro area filter to choose New York City. This filter uses a CBSA-style metro grouping to show only ZIP codes in the selected U.S. metro area instead of loading every ZIP code in the country; for other stories you could choose a different metro area.",
        targets: ["#cbsaWrap"],
        config: { origin: "country", dest: "us_zcta", source: "DO", metro: "NYC" },
        searchCbsa: "New York City",
      },
      {
        title: "Generate the ZIP-code map",
        body: "Now generate the map. The example fills in the title and subtitle, then renders ZIP codes in New York City by their connectedness to the Dominican Republic.",
        targets: ["#generate"],
        config: "full",
        generate: true,
      },
      {
        title: "Read the pattern",
        body:
          "The map highlights the geography of the Dominican diaspora in New York City, including strong connections around Washington Heights, Inwood, and much of the Bronx.",
        targets: ["#mapWrap"],
      },
    ],
  };
}

function polandMexicoChicagoZipStory() {
  const finalConfig = {
    mode: "compare",
    origin: "country",
    dest: "us_zcta",
    source: "PL",
    sourceB: "MX",
    metro: "16980",
    comparePaletteA: "Red",
    comparePaletteB: "Green",
    labelA: "Poland",
    labelB: "Mexico",
    borders: true,
    title: "Poland and Mexico in Chicago ZIP Codes",
    subtitle: "Relative connections to Poland and Mexico across the Chicago metro",
  };

  return {
    id: "poland-mexico-chicago-zips",
    title: "Polish & Mexican Migration to Chicago",
    setup: "Poland vs. Mexico -> Chicago ZIP codes",
    body:
      "In the late 19th and early 20th centuries, Chicago became one of the world's largest centers of Polish immigration, with a Polish population so large that the city was sometimes called the biggest Polish city outside Warsaw. But over the second half of the 20th century, Mexican immigration grew rapidly while Polish immigration declined. Neighborhoods such as Pilsen and Little Village became centers of Mexican-American life, transforming Chicago from a city known primarily for its Polish community into one of the nation's major centers of Mexican-American culture.",
    config: finalConfig,
    steps: [
      {
        title: "Switch to comparison mode",
        body:
          "Choose Compare two. A comparison map uses two home regions and colors each destination by which home region it is more connected to, rather than showing one source region's SCI levels on their own.",
        targets: ["#mapModeToggle"],
        config: { mode: "compare" },
      },
      {
        title: "Choose Country as the home level",
        body: "Under Friendships to, set Region type to Country. Both sides of this comparison will be countries.",
        targets: ["#originType"],
        config: { mode: "compare", origin: "country" },
      },
      {
        title: "Pick Poland as Region A",
        body: "Search for Poland and select it as Region A.",
        targets: ["#searchA", "#sourceA"],
        config: { mode: "compare", origin: "country", source: "PL" },
        searchA: "Poland",
      },
      {
        title: "Pick Mexico as Region B",
        body: "Search for Mexico and select it as Region B. The map will compare each ZIP code's connection to Poland against its connection to Mexico.",
        targets: ["#searchB", "#sourceB"],
        config: { mode: "compare", origin: "country", source: "PL", sourceB: "MX" },
        searchB: "Mexico",
      },
      {
        title: "Show ZIP-code detail",
        body: "Under Shown across, set Region type to US ZIP Code. This lets the comparison show fine-grained variation inside a metro area.",
        targets: ["#destType"],
        config: { mode: "compare", origin: "country", dest: "us_zcta", source: "PL", sourceB: "MX" },
      },
      {
        title: "Limit ZIP codes to Chicago",
        body:
          "Use the Metro area filter to choose the Chicago CBSA. For ZIP-code maps, this filter lets you focus on one U.S. metro area instead of drawing every ZIP code in the country.",
        targets: ["#cbsaWrap"],
        config: {
          mode: "compare",
          origin: "country",
          dest: "us_zcta",
          source: "PL",
          sourceB: "MX",
          metro: "16980",
        },
        searchCbsa: "Chicago",
      },
      {
        title: "Change the comparison colors",
        body:
          "Comparison colors are editable. Set Region A to red for Poland and Region B to green for Mexico; ZIP codes closer to the middle are more balanced between the two.",
        targets: ["#cpaletteWrap"],
        config: finalConfig,
      },
      {
        title: "Generate the comparison map",
        body: "Now generate the map. The example fills in the title, subtitle, legend labels, and colors, then renders the Chicago ZIP-code comparison.",
        targets: ["#generate"],
        config: "full",
        generate: true,
      },
      {
        title: "Read the pattern",
        body:
          "The comparison format emphasizes relative connection. Redder ZIP codes lean more toward Poland, greener ZIP codes lean more toward Mexico, reflecting Chicago's long shift from its historic Polish immigrant geography toward major Mexican-American centers such as Pilsen and Little Village.",
        targets: ["#mapWrap"],
      },
    ],
  };
}

export const DATA_STORIES = [
  usCountyStory({
    id: "cook-county-great-migration",
    title: "Cook County & the Great Migration",
    setup: "Cook County, IL -> U.S. counties",
    body:
      "The Illinois Central Railroad ran from the Mississippi Delta to Chicago's Twelfth Street Station. For decades, Black Southerners rode it north, making Chicago the Great Migration's northern capital. A century later, the SCI shows that Delta counties that sent Chicago its migrants remain among its over-connected distant communities today.",
    source: "17031",
    sourceName: "Cook County, IL",
    mapTitle: "Cook County, IL and the Great Migration",
    subtitle: "Connections from Cook County to U.S. counties",
    readPattern:
      "Many of Cook County's strongest distant county ties run through the Mississippi Delta, matching the migration corridor that carried Black Southerners north to Chicago on the Illinois Central Railroad.",
  }),
  portugalAfricaStory(),
  dominicanRepublicNycZipStory(),
  polandMexicoChicagoZipStory(),
  usCountyStory({
    id: "kern-county-dust-bowl-oil",
    title: "Kern County's Dust Bowl & Oil Patch Ties",
    setup: "Kern County, CA -> U.S. counties",
    body:
      "Today's friendship links from Kern County, CA (Bakersfield) extend all the way to Oklahoma. In the 1930s, the Dust Bowl drove displaced Oklahoma and Arkansas families to California. These \"Okies\" shaped their destination counties and helped give rise to the Bakersfield Sound, including Merle Haggard's \"Okie from Muskogee.\" The map also shows another long-distance link: Kern County, a center of California's oil industry, connects strongly to the Bakken formation in North Dakota.",
    source: "06029",
    sourceName: "Kern County, CA",
    mapTitle: "Kern County, CA: Dust Bowl and Oil Patch Ties",
    subtitle: "Connections from Kern County to U.S. counties",
    refq: 0.75,
    extraSteps: [
      {
        title: "Set the reference quantile",
        body:
          "Open Advanced options and set Reference quantile to 0.75. The map divides each county's SCI by Kern County's 75th-percentile county connection, so 1x means a county is as connected as that high baseline; larger labels show how many times stronger it is. With the Quantile break scheme, the Breaks box then spaces color bins across the mapped counties' multipliers.",
        targets: ["#singleBreaksWrap"],
        config: {
          origin: "us_county",
          dest: "us_county",
          source: "06029",
          refMode: "quantile",
          refq: 0.75,
          breakScheme: "quantile",
        },
        openAdvanced: true,
        refreshBreaks: true,
      },
    ],
    readPattern:
      "Look for two distant patterns: stronger friendship links into Oklahoma and Arkansas, consistent with Dust Bowl migration to Bakersfield, and strong links into North Dakota's Bakken oil region.",
  }),
];
