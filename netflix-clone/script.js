/*************************************************************************
  script.js
  - TMDB + YouTube ile çalışan, hatalara dayanıklı, solda detay+fragman paneli
  - Özellikler:
    * Filmler / Diziler / Animeler sekmeleri
    * Sonsuz kaydırma (popular / discover sayfalandırma)
    * Arama (search multi)
    * Kart tıklanınca solda detay paneli açılır, otomatik YouTube fragman embed
    * "İZLE" butonu fragmanı modal içinde oynatır
*************************************************************************/

/* -------------------- AYARLAR (kendi anahtarların burada) -------------------- */
const TMDB_KEY = "d0cee02c031433c37861a9b22b11854e";
const YT_KEY = "AIzaSyCjZ77zLEYbQike8KFuFpVLY10dbYEl6CQ";
/* ---------------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  // Temel DOM elemanları (eğer index.html farklı ise kod dinamik oluşturuyor)
  let grid = document.getElementById("grid");
  const loadingEl = document.getElementById("loading");

  // Eğer grid yoksa, movie-grid class'lı (yeni html versiyonlarına uyumlu) ile ara
  if (!grid) {
    grid = document.querySelector(".movie-grid") || document.createElement("div");
    grid.id = "grid";
    if (!document.querySelector(".container")) {
      document.body.appendChild(grid);
    } else {
      document.querySelector(".container").appendChild(grid);
    }
  }

  // Detay panel varsa kullan, yoksa dinamik oluştur
  let detailPanel = document.getElementById("detailPanel");
  if (!detailPanel) {
    detailPanel = document.createElement("aside");
    detailPanel.id = "detailPanel";
    detailPanel.className = "detail-panel";
    detailPanel.innerHTML = `
      <button id="closePanel" class="close">✕</button>
      <img id="detailPoster" alt="poster" />
      <div class="info">
        <h2 id="detailTitle"></h2>
        <p id="detailYear" class="muted"></p>
        <p id="detailGenres" class="muted"></p>
        <p id="detailRating" class="muted"></p>
        <p id="detailOverview"></p>
        <div id="trailerWrap">
          <iframe id="trailerFrame" frameborder="0" allowfullscreen></iframe>
        </div>
        <div class="panel-actions">
          <button id="watchBtn" class="primary">İZLE</button>
        </div>
      </div>
    `;
    document.body.appendChild(detailPanel);
  }

  // İzleme modal (eğer yoksa oluştur)
  let watchModal = document.getElementById("watchModal");
  if (!watchModal) {
    watchModal = document.createElement("div");
    watchModal.id = "watchModal";
    watchModal.className = "watch-modal";
    watchModal.innerHTML = `
      <div class="watch-inner">
        <button id="closeWatch" class="close-watch">✕</button>
        <iframe id="watchFrame" frameborder="0" allowfullscreen></iframe>
      </div>
    `;
    document.body.appendChild(watchModal);
  }

  // Detail panel içi referanslar (var olanlara göre al)
  const detailTitle = document.getElementById("detailTitle");
  const detailPoster = document.getElementById("detailPoster");
  const detailYear = document.getElementById("detailYear");
  const detailGenres = document.getElementById("detailGenres");
  const detailRating = document.getElementById("detailRating");
  const detailOverview = document.getElementById("detailOverview");
  const trailerFrame = document.getElementById("trailerFrame");
  const watchBtn = document.getElementById("watchBtn");
  const closePanelBtn = document.getElementById("closePanel");
  const closeWatchBtn = document.getElementById("closeWatch");
  const watchFrame = document.getElementById("watchFrame");

  // Bazı DOM elemanları olmayabilir; güvenli fallback:
  const searchInput = document.getElementById("searchInput") || document.querySelector(".search-box");
  const tabs = document.querySelectorAll(".tab") || [];

  // Uygulama durumu
  let page = 1;
  let loading = false;
  let currentType = "movie"; // 'movie' | 'tv' | 'anime'
  let lastQuery = ""; // arama sorgusu
  let totalPages = Infinity;

  // Helper: poster url veya placeholder
  function posterUrl(path) {
    if (!path) return "https://via.placeholder.com/300x450?text=No+Image";
    return `https://image.tmdb.org/t/p/w500${path}`;
  }

  // API çağrıları
  async function fetchTMDB(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("TMDB hata: " + res.status);
      return await res.json();
    } catch (err) {
      console.error("fetchTMDB error:", err);
      return null;
    }
  }

  // Filmleri / dizileri yükleme (popular / discover)
  async function loadMovies(reset = false) {
    if (loading) return;
    if (page > totalPages) return;
    loading = true;
    if (loadingEl) loadingEl.style.display = "block";

    // Eğer arama var -> multi search
    let url = "";
    if (lastQuery && lastQuery.trim().length > 0) {
      url = `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_KEY}&language=tr-TR&query=${encodeURIComponent(lastQuery)}&page=${page}`;
    } else {
      if (currentType === "movie") {
        url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_KEY}&language=tr-TR&page=${page}`;
      } else if (currentType === "tv") {
        url = `https://api.themoviedb.org/3/tv/popular?api_key=${TMDB_KEY}&language=tr-TR&page=${page}`;
      } else if (currentType === "anime") {
        // anime olarak animation türündeki filmleri getiriyoruz (TMDB'de tür id 16 = Animation)
        url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&language=tr-TR&with_genres=16&page=${page}`;
      }
    }

    const data = await fetchTMDB(url);
    if (!data) {
      loading = false;
      if (loadingEl) loadingEl.style.display = "none";
      return;
    }

    // data.results olabilir ya da farklı anahtar (search multi -> results)
    const results = data.results || [];
    // Eğer reset istendi ise grid temizle
    if (reset) {
      grid.innerHTML = "";
      page = 1;
    }

    // toplam sayfa bilgisi varsa kaydet
    totalPages = data.total_pages || totalPages;

    results.forEach(item => {
      // item tipi movie/tv/person vs olabilir (search multi). Filmler/diziler için uygun alanlar:
      const id = item.id;
      const title = item.title || item.name || item.original_title || item.original_name || "Başlıksız";
      const poster = item.poster_path || item.backdrop_path || null;
      createCard({ id, title, poster, raw: item, media_type: item.media_type || currentType });
    });

    page++;
    loading = false;
    if (loadingEl) loadingEl.style.display = "none";
  }

  // Kart oluştur
  function createCard(movie) {
    const card = document.createElement("div");
    card.className = "grid-card";
    card.innerHTML = `
      <img src="${posterUrl(movie.poster)}" alt="${escapeHtml(movie.title)}">
      <h4>${escapeHtml(movie.title)}</h4>
    `;
    card.addEventListener("click", () => openDetail(movie));
    grid.appendChild(card);
  }

  // Güvenli HTML escape (basit)
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[s]);
  }

  // Detay panel açma
  async function openDetail(movieOrRaw) {
    // movieOrRaw: {id, title, poster, media_type} veya raw item
    let id, media_type;
    if (movieOrRaw.raw) {
      id = movieOrRaw.raw.id;
      media_type = movieOrRaw.media_type || currentType;
    } else if (movieOrRaw.media_type) {
      id = movieOrRaw.id;
      media_type = movieOrRaw.media_type;
    } else {
      id = movieOrRaw.id;
      media_type = currentType;
    }

    // fetch detay (movie veya tv)
    try {
      const detailUrl = media_type === "tv"
        ? `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}&language=tr-TR&append_to_response=videos`
        : `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}&language=tr-TR&append_to_response=videos`;

      const data = await fetchTMDB(detailUrl);
      if (!data) return;

      // populate panel
      if (detailTitle) detailTitle.textContent = data.title || data.name || "Başlıksız";
      if (detailPoster) detailPoster.src = posterUrl(data.poster_path || data.backdrop_path);
      if (detailYear) {
        const date = data.release_date || data.first_air_date || "";
        detailYear.textContent = date ? date.split("-")[0] : "";
      }
      if (detailRating) detailRating.textContent = data.vote_average ? `IMDB: ${data.vote_average}` : "";
      if (detailOverview) detailOverview.textContent = data.overview || "Açıklama yok";
      if (detailGenres) {
        const g = (data.genres || []).map(g => g.name).join(", ");
        detailGenres.textContent = g;
      }

      // Trailer: önce TMDB içindeki videoları kontrol et (daha güvenli), sonra YT search yedek
      let youtubeId = null;
      if (data.videos && data.videos.results && data.videos.results.length > 0) {
        const trailer = data.videos.results.find(v => /trailer/i.test(v.type) && v.site === "YouTube") || data.videos.results[0];
        if (trailer && trailer.site === "YouTube") youtubeId = trailer.key;
      }

      if (youtubeId) {
        if (trailerFrame) trailerFrame.src = `https://www.youtube.com/embed/${youtubeId}`;
      } else {
        // yedek: YouTube API ile arama yap
        const q = encodeURIComponent((data.title || data.name) + " fragman");
        try {
          const yRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${q}&key=${YT_KEY}&maxResults=1`);
          const yData = await yRes.json();
          if (yData && yData.items && yData.items.length > 0) {
            const vid = yData.items[0].id.videoId;
            if (trailerFrame) trailerFrame.src = `https://www.youtube.com/embed/${vid}`;
          } else {
            if (trailerFrame) trailerFrame.src = "";
          }
        } catch (err) {
          console.error("YouTube search error:", err);
          if (trailerFrame) trailerFrame.src = "";
        }
      }

      // aç panel
      detailPanel.classList.add("open");
    } catch (err) {
      console.error("openDetail error:", err);
    }
  }

  // İzle butonu: modal içinde aynı fragmanı oynat
  if (watchBtn) {
    watchBtn.addEventListener("click", () => {
      const src = trailerFrame ? trailerFrame.src : "";
      if (!src) {
        alert("Fragman bulunamadı.");
        return;
      }
      watchFrame.src = src + "?autoplay=1";
      watchModal.classList.add("show");
    });
  }

  // Kapatma eventleri
  if (closePanelBtn) closePanelBtn.addEventListener("click", () => {
    detailPanel.classList.remove("open");
    if (trailerFrame) trailerFrame.src = "";
  });
  if (closeWatchBtn) closeWatchBtn.addEventListener("click", () => {
    watchModal.classList.remove("show");
    watchFrame.src = "";
  });

  // Escape tuşu ile modal / panel kapatma
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (detailPanel.classList.contains("open")) {
        detailPanel.classList.remove("open");
        if (trailerFrame) trailerFrame.src = "";
      }
      if (watchModal.classList.contains("show")) {
        watchModal.classList.remove("show");
        watchFrame.src = "";
      }
    }
  });

  // Tab eventleri (Filmler / Diziler / Animeler)
  if (tabs && tabs.length > 0) {
    tabs.forEach(t => {
      t.addEventListener("click", (e) => {
        tabs.forEach(x => x.classList.remove("active"));
        t.classList.add("active");
        const type = t.dataset.tab;
        if (type) {
          currentType = type === "movie" || type === "tv" ? type : (type === "anime" ? "anime" : "movie");
          page = 1; totalPages = Infinity; lastQuery = "";
          grid.innerHTML = "";
          loadMovies();
        }
      });
    });
  }

  // Arama
  if (searchInput) {
    let timer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = (searchInput.value || "").trim();
        lastQuery = q;
        page = 1;
        totalPages = Infinity;
        grid.innerHTML = "";
        loadMovies();
      }, 600);
    });
  }

  // Sonsuz scroll
  window.addEventListener("scroll", () => {
    if ((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 300)) {
      if (!loading) loadMovies();
    }
  });

  // İlk sayfa yükle
  loadMovies();
});
