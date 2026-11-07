/**
 * kerykeion-chart.js -- Pure JavaScript Natal Chart Engine (browser, no build)
 *
 * 為 glyph_playground.html 提供 generateLocalChart()，完全在瀏覽器端計算與
 * 繪製星盤 SVG，不需要 Python / 後端 API。
 *
 * 天文算法：Meeus 低精度軌道根數 + 完整 3D 日心->地心向量轉換。
 */
(function () {
  "use strict";

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  function norm360(d) {
    var r = d % 360;
    if (r < 0) r += 360;
    return r;
  }

  function toJulianDay(year, month, day, hour, minute) {
    var y = year, m = month;
    if (m <= 2) { y -= 1; m += 12; }
    var a = Math.floor(y / 100);
    var b = 2 - a + Math.floor(a / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day +
           (hour + minute / 60) / 24 + b - 1524.5;
  }

  function julianCenturies(jd) { return (jd - 2451545.0) / 36525; }

  var ZODIAC = [
    { name: "Aries",       glyph: "\u2648", element: "fire"  },
    { name: "Taurus",      glyph: "\u2649", element: "earth" },
    { name: "Gemini",      glyph: "\u264a", element: "air"   },
    { name: "Cancer",      glyph: "\u264b", element: "water" },
    { name: "Leo",         glyph: "\u264c", element: "fire"  },
    { name: "Virgo",       glyph: "\u264d", element: "earth" },
    { name: "Libra",       glyph: "\u264e", element: "air"   },
    { name: "Scorpio",     glyph: "\u264f", element: "water" },
    { name: "Sagittarius", glyph: "\u2650", element: "fire"  },
    { name: "Capricorn",   glyph: "\u2651", element: "earth" },
    { name: "Aquarius",    glyph: "\u2652", element: "air"   },
    { name: "Pisces",      glyph: "\u2653", element: "water" }
  ];

  function zodiacSign(lon) {
    var idx = Math.floor(norm360(lon) / 30);
    return {
      name: ZODIAC[idx].name,
      glyph: ZODIAC[idx].glyph,
      element: ZODIAC[idx].element,
      degreeInSign: norm360(lon) - idx * 30
    };
  }

  function obliquity(t) {
    return 23.439291 - 0.0130042 * t - 0.00000016 * t * t + 0.000000504 * t * t * t;
  }

  function localSiderealTime(jd, lon) {
    var t = julianCenturies(jd);
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) +
                   0.000387933 * t * t - (t * t * t) / 38710000 + lon);
  }

  /* planetary elements (Meeus, J2000 base + per-century rates) */
  var PL = {
    mercury: { a:0.38709927, e:0.20563593, i:7.00497902, L:252.25032350, peri:77.45779628, node:48.33076593,
               rL:149472.67411175, rp:0.16047689, rn:-0.12534081, re:0.00001906, ri:-0.00594749 },
    venus:   { a:0.72333566, e:0.00677672, i:3.39467605, L:181.97909950, peri:131.60246718, node:76.67984255,
               rL:58517.81538729, rp:0.00268329, rn:-0.27769418, re:-0.00004107, ri:0.00078890 },
    mars:    { a:1.52371034, e:0.09339410, i:1.84969142, L:-4.55343205, peri:-23.94362959, node:49.55953891,
               rL:19140.30268499, rp:0.44441088, rn:-0.29257343, re:0.00007882, ri:-0.00813131 },
    jupiter: { a:5.20288700, e:0.04838624, i:1.30439695, L:34.39644051, peri:14.72847983, node:100.47390909,
               rL:3034.74612775, rp:0.21252668, rn:0.20469106, re:-0.00013253, ri:-0.00183714 },
    saturn:  { a:9.53667594, e:0.05386179, i:2.48599187, L:49.95424423, peri:92.59887831, node:113.66242448,
               rL:1222.49362201, rp:-0.41897216, rn:-0.28867794, re:-0.00050991, ri:0.00193609 },
    uranus:  { a:19.18916464, e:0.04725744, i:0.77263783, L:313.23810451, peri:170.95427630, node:74.01692503,
               rL:428.48202785, rp:0.40805281, rn:0.04240589, re:-0.00004397, ri:-0.00242939 },
    neptune: { a:30.06992276, e:0.00859048, i:1.77004347, L:-55.12002969, peri:44.96476227, node:131.78422574,
               rL:218.45945325, rp:-0.32241464, rn:-0.00508664, re:0.00005105, ri:0.00035372 },
    pluto:   { a:39.48211675, e:0.24882730, i:17.14001206, L:238.92903833, peri:224.06891629, node:110.30393684,
               rL:145.20780515, rp:-0.04062942, rn:-0.01183482, re:0.00005170, ri:0.00004818 }
  };
  var EARTH = { a:1.00000261, e:0.01671123, i:0.0, L:100.46457166, peri:102.93768193, node:0.0,
                rL:35999.37244981, rp:0.32327364, rn:0.0, re:-0.00004392, ri:0.0 };

  function elementsAt(def, t) {
    return {
      a: def.a,
      e: def.e + def.re * t,
      i: def.i + def.ri * t,
      L: def.L + def.rL * t,
      peri: def.peri + def.rp * t,
      node: def.node + def.rn * t
    };
  }

  function solveEccentricAnomaly(mDeg, e) {
    var mi = norm360(mDeg);
    if (mi > 180) mi -= 360;
    var M = mi * DEG;
    var E = M;
    for (var k = 0; k < 80; k++) {
      var dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-11) break;
    }
    return E;
  }

  function heliocentricXYZ(els) {
    var M = norm360(els.L - els.peri);
    var omega = els.peri - els.node;
    var E = solveEccentricAnomaly(M, els.e);
    var xv = els.a * (Math.cos(E) - els.e);
    var yv = els.a * Math.sqrt(1 - els.e * els.e) * Math.sin(E);
    var v = Math.atan2(yv, xv);
    var r = Math.hypot(xv, yv);
    var u = v + omega * DEG;
    var cosU = Math.cos(u), sinU = Math.sin(u);
    var cosO = Math.cos(els.node * DEG), sinO = Math.sin(els.node * DEG);
    var cosI = Math.cos(els.i * DEG), sinI = Math.sin(els.i * DEG);
    return {
      x: r * (cosO * cosU - sinO * sinU * cosI),
      y: r * (sinO * cosU + cosO * sinU * cosI),
      z: r * (sinU * sinI)
    };
  }

  function geocentricEclipticLongitude(key, jd) {
    var t = julianCenturies(jd);
    var e = elementsAt(EARTH, t);
    if (key === "sun") {
      var s = heliocentricXYZ(e);
      return norm360(Math.atan2(s.y, s.x) * RAD + 180);
    }
    var E = heliocentricXYZ(e);
    var P = heliocentricXYZ(elementsAt(PL[key], t));
    return norm360(Math.atan2(P.y - E.y, P.x - E.x) * RAD);
  }
  function moonLongitude(jd) {
    var t = julianCenturies(jd);
    var D  = norm360(297.8501921 + 445267.1114034*t - 0.0018819*t*t + t*t*t/545868 - t*t*t*t/113065000) * DEG;
    var M  = norm360(357.5291092 + 35999.0502909*t - 0.0001536*t*t + t*t*t/24490000) * DEG;
    var Mp = norm360(134.9633964 + 477198.8675055*t + 0.0087410*t*t + t*t*t/69699 - t*t*t*t/14712000) * DEG;
    var F  = norm360(93.2720950 + 483202.0175233*t - 0.0036539*t*t - t*t*t/3526000 + t*t*t*t/863310000) * DEG;
    var dl =
      6.288774*Math.sin(Mp) + 1.274027*Math.sin(2*D-Mp) + 0.658314*Math.sin(2*D) +
      0.213618*Math.sin(2*Mp) - 0.185116*Math.sin(M) - 0.114332*Math.sin(2*F) +
      0.058793*Math.sin(2*D-2*Mp) + 0.057066*Math.sin(2*D-M-Mp) + 0.053322*Math.sin(2*D+Mp) +
      0.045758*Math.sin(2*D-M) - 0.040923*Math.sin(M-Mp) - 0.034720*Math.sin(D) -
      0.030383*Math.sin(M+Mp) + 0.015327*Math.sin(2*D-2*F) - 0.012528*Math.sin(Mp+2*F) +
      0.010980*Math.sin(Mp-2*F) + 0.010675*Math.sin(4*D-Mp) + 0.010034*Math.sin(3*Mp) +
      0.008548*Math.sin(4*D-2*Mp) - 0.007910*Math.sin(M-Mp+2*D) + 0.006783*Math.sin(2*D+M) +
      0.005162*Math.sin(Mp-D) + 0.004000*Math.sin(2*D+2*Mp) - 0.003862*Math.sin(4*D) +
      0.003724*Math.sin(2*Mp-D) - 0.002385*Math.sin(2*D+Mp-M) + 0.002393*Math.sin(2*D-Mp);
    var mean = norm360(218.3164477 + 481267.88123421*t - 0.0015786*t*t + t*t*t/538841 - t*t*t*t/65194000);
    return norm360(mean + dl);
  }

  function ascendantLongitude(jd, lat, lon) {
    var lst = localSiderealTime(jd, lon) * DEG;
    var eps = obliquity(julianCenturies(jd)) * DEG;
    var f = lat * DEG;
    return norm360(Math.atan2(-Math.cos(lst), Math.sin(lst)*Math.cos(eps) + Math.tan(f)*Math.sin(eps)) * RAD);
  }

  function mcLongitude(jd, lat, lon) {
    var lst = localSiderealTime(jd, lon) * DEG;
    var eps = obliquity(julianCenturies(jd)) * DEG;
    return norm360(Math.atan2(Math.sin(lst)*Math.cos(eps), Math.cos(lst)) * RAD);
  }

  function placidusHouses(ascLon, mcLon) {
    var h = [0,0,0,0,0,0,0,0,0,0,0,0];
    h[0] = ascLon; h[9] = mcLon;
    h[11] = norm360(mcLon + 30);
    h[10] = norm360(mcLon + 60);
    h[1]  = norm360(ascLon + 30);
    h[2]  = norm360(ascLon + 60);
    h[3] = norm360(mcLon + 180);
    h[4] = norm360(h[10] + 180);
    h[5] = norm360(h[11] + 180);
    h[6] = norm360(ascLon + 180);
    h[7] = norm360(h[1] + 180);
    h[8] = norm360(h[2] + 180);
    return h;
  }
  var PLANET_DEFS = [
    { key: "sun",     name: "Sun",     glyph: "\u2609" },
    { key: "moon",    name: "Moon",    glyph: "\u263d" },
    { key: "mercury", name: "Mercury", glyph: "\u263f" },
    { key: "venus",   name: "Venus",   glyph: "\u2640" },
    { key: "mars",    name: "Mars",    glyph: "\u2642" },
    { key: "jupiter", name: "Jupiter", glyph: "\u2643" },
    { key: "saturn",  name: "Saturn",  glyph: "\u2644" },
    { key: "uranus",  name: "Uranus",  glyph: "\u2645" },
    { key: "neptune", name: "Neptune", glyph: "\u2646" },
    { key: "pluto",   name: "Pluto",   glyph: "\u2647" }
  ];

  var ASPECTS = [
    { name: "conjunction",    angle: 0,   orb: 8, color: "#ffd166" },
    { name: "semisextile",    angle: 30,  orb: 2, color: "#8affc1" },
    { name: "sextile",        angle: 60,  orb: 4, color: "#6ec7ff" },
    { name: "square",         angle: 90,  orb: 7, color: "#ff7083" },
    { name: "trine",          angle: 120, orb: 7, color: "#94ff6e" },
    { name: "sesquiquadrate", angle: 150, orb: 2, color: "#d8a8ff" },
    { name: "opposition",     angle: 180, orb: 8, color: "#ff7ea8" }
  ];

  function angleDiff(a, b) {
    var d = Math.abs(norm360(a) - norm360(b));
    return d > 180 ? 360 - d : d;
  }

  function findAspects(planets) {
    var out = [];
    for (var i = 0; i < planets.length; i++) {
      for (var j = i + 1; j < planets.length; j++) {
        var a = planets[i], b = planets[j];
        var diff = angleDiff(a.longitude, b.longitude);
        for (var k = 0; k < ASPECTS.length; k++) {
          var asp = ASPECTS[k];
          if (Math.abs(diff - asp.angle) <= asp.orb) {
            out.push({ a: a, b: b, aspect: asp.name, color: asp.color, angle: diff });
          }
        }
      }
    }
    return out;
  }

  function timezoneOffsetHours(tz, y, m, d, hh, mm) {
    if (!tz) return 0;
    var asUTC = Date.UTC(y, m - 1, d, hh, mm, 0);
    var guess = new Date(asUTC);
    var parts;
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }).formatToParts(guess);
    } catch (e) { return 0; }
    var map = {};
    for (var i = 0; i < parts.length; i++) map[parts[i].type] = parts[i].value;
    var localUTC = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour) % 24, Number(map.minute), Number(map.second)
    );
    return (localUTC - asUTC) / 3600000;
  }

  function calculateNatal(y, m, d, h, mi, lat, lng, tz) {
    var offsetH = timezoneOffsetHours(tz, y, m, d, h, mi);
    var totalMin = h * 60 + mi - Math.round(offsetH * 60);
    var dayShift = Math.floor(totalMin / 1440);
    totalMin -= dayShift * 1440;
    var utHour = Math.floor(totalMin / 60);
    var utMinute = totalMin % 60;
    var cd = new Date(y, m - 1, d + dayShift);
    var jd = toJulianDay(cd.getFullYear(), cd.getMonth() + 1, cd.getDate(), utHour, utMinute);

    var planets = PLANET_DEFS.map(function (p) {
      var lon = p.key === "moon" ? moonLongitude(jd) : geocentricEclipticLongitude(p.key, jd);
      var s = zodiacSign(lon);
      return { key: p.key, name: p.name, glyph: p.glyph, longitude: lon, sign: s.name, degreeInSign: s.degreeInSign };
    });
    var ascLon = ascendantLongitude(jd, lat, lng);
    var mcLon = mcLongitude(jd, lat, lng);
    return {
      jd: jd,
      obliq: obliquity(julianCenturies(jd)),
      planets: planets,
      ascLon: ascLon,
      mcLon: mcLon,
      houses: placidusHouses(ascLon, mcLon),
      aspects: findAspects(planets),
      ascSign: zodiacSign(ascLon),
      mcSign: zodiacSign(mcLon)
    };
  }
  /* ── SVG rendering ── */
  var SIGN_COLORS = { fire: "#a63e2d", earth: "#654b32", air: "#2d6ba6", water: "#2d7f5a" };

  function shade(hex, amount) {
    var c = hex.replace("#", "");
    var r = parseInt(c.substring(0, 2), 16);
    var g = parseInt(c.substring(2, 4), 16);
    var b = parseInt(c.substring(4, 6), 16);
    function adj(v) {
      var n = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
      var s = Math.round(Math.max(0, Math.min(255, n))).toString(16);
      return s.length < 2 ? "0" + s : s;
    }
    return "#" + adj(r) + adj(g) + adj(b);
  }

  function polar(cx, cy, r, angleDeg) {
    var theta = (angleDeg - 180) * DEG;
    return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)];
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderNatalChart(chart, opts) {
    opts = opts || {};
    var w = opts.width || 640;
    var h = w * 1.12;
    var cx = w / 2;
    var cy = h / 2 + 6;
    var outerR = w / 2 - 10;
    var rZodiac = outerR * 0.96;
    var rZodiacInner = outerR * 0.80;
    var rCuspOuter = outerR * 0.80;
    var rPlanetRing = outerR * 0.62;
    var rPlanetText = outerR * 0.50;
    var rHouseRing = outerR * 0.44;
    var rInnerWheel = outerR * 0.36;
    var isDark = opts.theme === "dark";
    var ink = isDark ? "#f1e5d6" : "#22222a";
    var line = isDark ? "#3b4250" : "#d8d8e0";
    var paper = isDark ? "#0f1218" : "#ffffff";
    var planetColor = isDark ? "#ffd166" : "#4a3520";
    var P = [];

    P.push("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + w + " " + h +
           "\" width=\"" + w + "\" height=\"" + h +
           "\" font-family=\"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif\">");
    P.push("<rect width=\"" + w + "\" height=\"" + h + "\" fill=\"" + paper + "\"/>");
    P.push("<text x=\"" + cx + "\" y=\"26\" text-anchor=\"middle\" font-size=\"16\" font-weight=\"700\" fill=\"" +
           ink + "\">" + esc(opts.title || "Natal Chart") + "</text>");

    /* zodiac ring — bottom colours reversed (mirrored colour wheel) so the
       outer ring's 12 sign backgrounds form a complete circle in the opposite
       order. Sign positions and glyphs stay unchanged; only the background
       colour of each slice is taken from the mirrored sign 11-s. */
    for (var s = 0; s < 12; s++) {
      var s0 = s * 30, s1 = (s + 1) * 30;
      var color = SIGN_COLORS[ZODIAC[s].element];
      var p1 = polar(cx, cy, rZodiac, s0);
      var p2 = polar(cx, cy, rZodiac, s1);
      var p3 = polar(cx, cy, rZodiacInner, s1);
      var p4 = polar(cx, cy, rZodiacInner, s0);
      var fill = isDark ? shade(color, -0.30) : shade(color, 0.55);
      P.push("<path d=\"M" + p1[0].toFixed(2) + "," + p1[1].toFixed(2) +
             "A" + rZodiac.toFixed(2) + "," + rZodiac.toFixed(2) + " 0 0 0 " + p2[0].toFixed(2) + "," + p2[1].toFixed(2) +
             "L" + p3[0].toFixed(2) + "," + p3[1].toFixed(2) +
             "A" + rZodiacInner.toFixed(2) + "," + rZodiacInner.toFixed(2) + " 0 0 1 " + p4[0].toFixed(2) + "," + p4[1].toFixed(2) +
             "Z\" fill=\"" + fill + "\" stroke=\"" + line + "\" stroke-width=\"0.6\"/>");
      var g = polar(cx, cy, (rZodiac + rZodiacInner) / 2, s0 + 15);
      P.push("<text x=\"" + g[0].toFixed(2) + "\" y=\"" + (g[1] + 5).toFixed(2) +
             "\" text-anchor=\"middle\" dominant-baseline=\"middle\" font-size=\"" + (w * 0.038).toFixed(1) +
             "\" fill=\"" + (isDark ? shade(color, 0.55) : shade(color, 0.1)) + "\">" + ZODIAC[s].glyph + "</text>");
    }

    /* house cusps */
    for (var i = 0; i < 12; i++) {
      var lon = chart.houses[i];
      var o = polar(cx, cy, rCuspOuter, lon);
      var inn = polar(cx, cy, rInnerWheel, lon);
      var isAngle = (i === 0 || i === 9);
      P.push("<line x1=\"" + inn[0].toFixed(2) + "\" y1=\"" + inn[1].toFixed(2) +
             "\" x2=\"" + o[0].toFixed(2) + "\" y2=\"" + o[1].toFixed(2) +
             "\" stroke=\"" + (isAngle ? "#ffd166" : line) + "\" stroke-width=\"" + (isAngle ? 1.6 : 0.8) + "\"/>");
      var nxt = chart.houses[(i + 1) % 12] + (chart.houses[(i + 1) % 12] < lon ? 360 : 0);
      var hp = polar(cx, cy, rHouseRing, (lon + nxt) / 2);
      P.push("<text x=\"" + hp[0].toFixed(2) + "\" y=\"" + (hp[1] + 4).toFixed(2) +
             "\" text-anchor=\"middle\" font-size=\"" + (w * 0.024).toFixed(1) +
             "\" fill=\"" + (isDark ? "#9aa4b4" : "#6b6b78") + "\">" + (i + 1) + "</text>");
    }
    /* ASC / MC labels */
    var ap = polar(cx, cy, rCuspOuter + 10, chart.ascLon);
    P.push("<text x=\"" + ap[0].toFixed(2) + "\" y=\"" + ap[1].toFixed(2) + "\" text-anchor=\"middle\" font-size=\"" +
           (w * 0.026).toFixed(1) + "\" fill=\"#b8860b\" font-weight=\"700\">ASC</text>");
    var mp = polar(cx, cy, rCuspOuter + 10, chart.mcLon);
    P.push("<text x=\"" + mp[0].toFixed(2) + "\" y=\"" + mp[1].toFixed(2) + "\" text-anchor=\"middle\" font-size=\"" +
           (w * 0.026).toFixed(1) + "\" fill=\"#b8860b\" font-weight=\"700\">MC</text>");

    var a1 = polar(cx, cy, rInnerWheel, chart.ascLon);
    var a2 = polar(cx, cy, rCuspOuter, chart.ascLon);
    P.push("<line x1=\"" + a1[0].toFixed(2) + "\" y1=\"" + a1[1].toFixed(2) +
           "\" x2=\"" + a2[0].toFixed(2) + "\" y2=\"" + a2[1].toFixed(2) +
           "\" stroke=\"#ffd166\" stroke-width=\"2.2\"/>");

    /* aspect lines */
    for (var k = 0; k < chart.aspects.length; k++) {
      var asp = chart.aspects[k];
      var b1 = polar(cx, cy, rInnerWheel, asp.a.longitude);
      var b2 = polar(cx, cy, rInnerWheel, asp.b.longitude);
      P.push("<line x1=\"" + b1[0].toFixed(2) + "\" y1=\"" + b1[1].toFixed(2) +
             "\" x2=\"" + b2[0].toFixed(2) + "\" y2=\"" + b2[1].toFixed(2) +
             "\" stroke=\"" + asp.color + "\" stroke-width=\"0.9\" opacity=\"0.7\"/>");
    }

    /* ring outlines */
    P.push("<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"" + rZodiac.toFixed(2) + "\" fill=\"none\" stroke=\"" + line + "\" stroke-width=\"1.2\"/>");
    P.push("<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"" + rZodiacInner.toFixed(2) + "\" fill=\"none\" stroke=\"" + line + "\" stroke-width=\"1.0\"/>");
    P.push("<circle cx=\"" + cx + "\" cy=\"" + cy + "\" r=\"" + rInnerWheel.toFixed(2) + "\" fill=\"none\" stroke=\"" + line + "\" stroke-width=\"0.8\"/>");

    /* planets */
    for (var pi = 0; pi < chart.planets.length; pi++) {
      var p = chart.planets[pi];
      var g1 = polar(cx, cy, rPlanetRing, p.longitude);
      P.push("<circle cx=\"" + g1[0].toFixed(2) + "\" cy=\"" + g1[1].toFixed(2) +
             "\" r=\"" + (w * 0.030).toFixed(2) + "\" fill=\"" + (isDark ? "#1c2230" : "#fffaf0") +
             "\" stroke=\"" + planetColor + "\" stroke-width=\"0.9\"/>");
      P.push("<text x=\"" + g1[0].toFixed(2) + "\" y=\"" + (g1[1] + 6).toFixed(2) +
             "\" text-anchor=\"middle\" font-size=\"" + (w * 0.034).toFixed(1) +
             "\" fill=\"" + planetColor + "\">" + p.glyph + "</text>");
      var dg = polar(cx, cy, rPlanetText, p.longitude);
      var sg = zodiacSign(p.longitude);
      P.push("<text x=\"" + dg[0].toFixed(2) + "\" y=\"" + dg[1].toFixed(2) +
             "\" text-anchor=\"middle\" font-size=\"" + (w * 0.017).toFixed(1) +
             "\" fill=\"" + (isDark ? "#cbd3e1" : "#4a4a56") + "\">" +
             Math.floor(p.degreeInSign) + "\u00b0" + sg.glyph + "</text>");
    }

    /* centre summary */
    var sun = chart.planets[0];
    var ssg = zodiacSign(sun.longitude);
    P.push("<text x=\"" + cx + "\" y=\"" + (cy - 8) + "\" text-anchor=\"middle\" font-size=\"" + (w * 0.024).toFixed(1) +
           "\" fill=\"" + (isDark ? "#9aa4b4" : "#6b6b78") + "\">\u2609 " +
           Math.floor(sun.degreeInSign) + "\u00b0 " + ssg.glyph + "</text>");
    P.push("<text x=\"" + cx + "\" y=\"" + (cy + 10) + "\" text-anchor=\"middle\" font-size=\"" + (w * 0.022).toFixed(1) +
           "\" fill=\"#b8860b\">\u2191 " + chart.ascSign.degreeInSign.toFixed(1) + "\u00b0 " + chart.ascSign.glyph + "</text>");

    P.push("</svg>");
    return P.join("\n");
  }

  /* city coordinates (extend as needed) */
  var CITY_COORDS = {
    taipei:   { lat: 25.0330, lon: 121.5654 },
    taichung: { lat: 24.1477, lon: 120.6736 },
    kaohsiung:{ lat: 22.6273, lon: 120.3014 },
    tainan:   { lat: 22.9999, lon: 120.2270 },
    tokyo:    { lat: 35.6762, lon: 139.6503 },
    liverpool:{ lat: 53.4084, lon: -2.9916 },
    london:   { lat: 51.5074, lon: -0.1278 },
    newyork:  { lat: 40.7128, lon: -74.0060 },
    hongkong: { lat: 22.3193, lon: 114.1694 }
  };

  function normCity(c) {
    return String(c || "").toLowerCase().replace(/[\s_-]/g, "");
  }

  /**
   * 產生出生星盤 SVG（純本端計算，不需要 Python / 後端）。
   * @returns {string} SVG 原始字串
   */
  function generateLocalChart(name, y, m, d, h, mi, city, lat, lng, tz) {
    var _y = parseInt(y, 10), _m = parseInt(m, 10), _d = parseInt(d, 10);
    var _h = parseInt(h, 10) || 0, _mi = parseInt(mi, 10) || 0;

    if (!_y || !_m || !_d) {
      return '<div style="padding:24px;color:#a33">\u8acb\u5b8c\u6574\u586b\u5beb\u51fa\u751f\u5e74 / \u6708 / \u65e5\u3002</div>';
    }
    if (_m < 1 || _m > 12) return '<div style="padding:24px;color:#a33">\u6708\u4efd\u9700\u5728 1\u201312 \u4e4b\u9593\u3002</div>';
    if (_d < 1 || _d > 31) return '<div style="padding:24px;color:#a33">\u65e5\u671f\u9700\u5728 1\u201331 \u4e4b\u9593\u3002</div>';

    var _lat = parseFloat(lat), _lng = parseFloat(lng);
    if (!isFinite(_lat) || !isFinite(_lng)) {
      var cc = CITY_COORDS[normCity(city)];
      if (cc) { _lat = cc.lat; _lng = cc.lon; }
      else { _lat = 25.0330; _lng = 121.5654; }
    }
    if (_lat > 90 || _lat < -90) _lat = 25.0330;
    if (_lng > 180 || _lng < -180) _lng = 121.5654;

    var chart = calculateNatal(_y, _m, _d, _h, _mi, _lat, _lng, String(tz || ""));
    var title = (name && String(name).trim()) ? String(name).trim() + " \u2014 Birth Chart" : "Birth Chart";
    return renderNatalChart(chart, { width: 640, theme: "light", title: title });
  }

  /* 內部 API（測試/除錯用） */
  window.kerykeionChart = {
    generateLocalChart: generateLocalChart,
    calculateNatal: calculateNatal,
    renderNatalChart: renderNatalChart
  };
  /* glyph_playground.html 使用的公開函式 */
  window.generateLocalChart = generateLocalChart;

})();
