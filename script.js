/*•	Why do we need async/await when using fetch()?
The fetch method returns a Promise object and not the data 
immediately because there is a delay between network requests.
Using an async/await allows us to make these async functions as if
they were synchronous, which simplifies the code and it reduces the
need for complex nested callback structures. It makes sure that the
code waits for the Promise to be completed before assigning the resolved
value to a variable.

*What does OpenTDB response_code mean in your implementation? Explain 0 and 5.
The response_code is a status indicator returned by the OpenTDB API to
tell the application wether the request was successful or if there was an
error along the way. A code of 0 means successful, which means we got the
trivia results. 5 tells it that the rate limit has been exceed, meaning the user
is making requests too much too quickly and must wait.

*What exactly is stored under STORAGE_KEY and why is JSON used?
The STORAGE_KEY is where the application stores a JavaScript object
containing the player's bestScore, bestTotal, and the number of quiz attempts.
JSON is used because the Web Storage API can only store data as strings, and it
helps it stringify the complex object for storage and they parse it back into a
usable object.

*Describe what happens from clicking Start Quiz until the first question is displayed
(mention the functions involved).Clicking the Start Quiz runs the runRoundFlow, which then calls the validateStartForm
to make sure that the inputs are collect and startFromForm to update the player state.
It then starts the quiz with beginRound, it switches the UI by showOnly, and then it
fetches the data using getToken and fetchQuestions. Once we get, process and decode the
data, it calls the renderQuestion func to dynamically create the DOM elements and show
the first question.
*/

(function () {
  "use strict";

  var ROUND = { difficulty: "easy", amount: 10 };
  var STORAGE_KEY = "lab6_trivia_best";

  var API = {
    token: "https://opentdb.com/api_token.php?command=request",
    questionsUrl: function (amount, difficulty, category, token) {
      var p = new URLSearchParams();
      p.set("amount", String(amount));
      p.set("difficulty", difficulty);
      p.set("type", "multiple");
      if (category) { p.set("category", category); }
      if (token) { p.set("token", token); }
      return "https://opentdb.com/api.php?" + p.toString();
    }
  };

  function $(id) { return document.getElementById(id); }

  var screenStart  = $("screenStart");
  var screenQuiz   = $("screenQuiz");
  var screenResult = $("screenResult");

  var nameInput      = $("name");
  var emailInput     = $("email");
  var categorySelect = $("category");
  var modeSelect     = $("mode");

  var errName  = $("errName");
  var errEmail = $("errEmail");

  var btnStart     = $("btnStart");
  var btnReset     = $("btnReset");
  var btnQuit      = $("btnQuit");
  var btnPlayAgain = $("btnPlayAgain");
  var btnHome      = $("btnHome");

  var progressBox = $("progressBox");
  var quizTitle   = $("quizTitle");
  var scoreEl     = $("score");
  var qNumEl      = $("qNum");
  var qTotalEl    = $("qTotal");
  var questionText= $("questionText");
  var choicesBox  = $("choices");
  var loadingBox  = $("loadingBox");
  var apiErrorBox = $("apiErrorBox");
  var resultTitle = $("resultTitle");
  var resultText  = $("resultText");
  var reviewBox   = $("reviewBox");

  var state = {
    player: { name: "", email: "", category: "", mode: "easy" },
    token: null,
    questions: [],
    idx: 0,
    score: 0
  };

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function showOnly(which) {
    hide(screenStart);
    hide(screenQuiz);
    hide(screenResult);
    show(which);
  }

  function setLoading(on) {
    if (on) show(loadingBox); else hide(loadingBox);
  }

  function setApiError(msg) {
    if (!msg) {
      apiErrorBox.textContent = "";
      hide(apiErrorBox);
      return;
    }
    apiErrorBox.textContent = msg;
    show(apiErrorBox);
  }

  function decodeHTMLEntities(s) {
    var t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }

  function shuffle(arr) {
    var a = arr.slice();
    var i, j, tmp;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }


  function validateStartForm() {
    errName.textContent = "";
    errEmail.textContent = "";

    var name = nameInput.value.trim();
    var email = emailInput.value.trim();

    var valid = true;

    // Name: 2-30 chars after trim
    if (name.length < 2 || name.length > 30) {
      errName.textContent = "Name must be 2–30 characters.";
      valid = false;
    }

    // Email: basic shape (a@b.com)
    var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      errEmail.textContent = "Enter a valid email (e.g., name@domain.com).";
      valid = false;
    }

    return valid;
  }


  function loadProgress() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { bestScore: 0, bestTotal: 0, attempts: 0 };
      var parsed = JSON.parse(stored);
      // ensure shape
      if (parsed && typeof parsed === 'object') {
        return {
          bestScore: parsed.bestScore || 0,
          bestTotal: parsed.bestTotal || 0,
          attempts:  parsed.attempts || 0
        };
      }
    } catch (e) {}
    return { bestScore: 0, bestTotal: 0, attempts: 0 };
  }


  function saveProgress(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }


  async function getToken() {
    var res = await fetch(API.token);
    if (!res.ok) throw new Error(`Token HTTP ${res.status}`);
    var data = await res.json();
    if (!data.token) throw new Error("No token in response");
    return data.token;
  }


  async function fetchQuestions(cfg) {
    var url = API.questionsUrl(cfg.amount, cfg.difficulty, state.player.category, state.token);
    var res = await fetch(url);
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    var data = await res.json();

    if (data.response_code === 0) {
      return data.results;
    } else if (data.response_code === 5) {
      throw new Error("Rate limit exceeded (code 5). Please wait a few seconds.");
    } else {
      throw new Error(`API error code ${data.response_code}`);
    }
  }


  function renderBest() {
    var p = loadProgress();
    var bestScore = p.bestScore, bestTotal = p.bestTotal, attempts = p.attempts;
    if (bestTotal > 0) {
      progressBox.textContent = `Best score: ${bestScore}/${bestTotal} • Attempts: ${attempts}`;
    } else {
      progressBox.textContent = `Best score: none yet • Attempts: ${attempts}`;
    }
  }

  function startFromForm() {
    state.player.name = nameInput.value.trim();
    state.player.email = emailInput.value.trim();
    state.player.category = categorySelect.value;
    state.player.mode = modeSelect.value;
  }

  function beginRound() {
    state.questions = [];
    state.idx = 0;
    state.score = 0;
    scoreEl.textContent = "0";
    qNumEl.textContent = "1";
    qTotalEl.textContent = String(ROUND.amount);
    setApiError(null);
  }

  function renderQuestion() {
    var q = state.questions[state.idx];
    quizTitle.textContent = "Trivia Round (" + ROUND.difficulty + ")";
    qTotalEl.textContent = String(ROUND.amount);
    qNumEl.textContent = String(state.idx + 1);
    questionText.textContent = q.question;
    choicesBox.innerHTML = "";

    for (var i = 0; i < q.choices.length; i++) {
      (function (choiceText) {
        var btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = choiceText;
        btn.addEventListener("click", function () {
          handleAnswer(choiceText);
        });
        choicesBox.appendChild(btn);
      })(q.choices[i]);
    }
  }

  function handleAnswer(choiceText) {
    var q = state.questions[state.idx];
    q.userChoice = choiceText;               // store for review

    if (choiceText === q.correct) {
      state.score++;
      scoreEl.textContent = String(state.score);
    }

    state.idx++;
    if (state.idx >= ROUND.amount) {
      finishRound();
    } else {
      renderQuestion();
    }
  }


  function finishRound() {
    showOnly(screenResult);
    resultTitle.textContent = "Result";
    resultText.textContent = state.player.name + ", your score is " + state.score + "/" + ROUND.amount + ".";

    var lines = [];
    lines.push("Answer Review (Your answer vs Correct answer):");
    lines.push("");

    for (var i = 0; i < state.questions.length; i++) {
      var qq = state.questions[i];
      lines.push((i + 1) + ") " + qq.question);

      var yourAns = qq.userChoice || "(not answered)";
      var correct = qq.correct;
      var mark = (yourAns === correct) ? "✓" : "✗";
      var markClass = (yourAns === correct) ? "correct-mark" : "wrong-mark";

      lines.push(`   Your answer: ${yourAns}   Correct: ${correct}   ${mark}`);
      lines.push("");
    }

    reviewBox.innerHTML = lines.join("\n").replace(/✓/g, '<span class="correct-mark">✓</span>').replace(/✗/g, '<span class="wrong-mark">✗</span>');

    // Update best score
    var p = loadProgress();
    var attempts = p.attempts + 1;
    var bestScore = p.bestScore;
    var bestTotal = p.bestTotal;

    if (bestTotal === 0 || state.score > bestScore) {
      saveProgress({ bestScore: state.score, bestTotal: ROUND.amount, attempts: attempts });
    } else {
      saveProgress({ bestScore: bestScore, bestTotal: bestTotal, attempts: attempts });
    }

    renderBest();
  }

  async function runRoundFlow() {
    if (!validateStartForm()) return;

    startFromForm();


    ROUND.difficulty = state.player.mode;   // "easy", "medium", "hard"

    beginRound();
    showOnly(screenQuiz);

    try {
      setLoading(true);

      if (!state.token) {
        state.token = await getToken();
      }

      var raw = await fetchQuestions(ROUND);

      state.questions = [];
      for (var i = 0; i < raw.length; i++) {
        var item = raw[i];
        var correct = decodeHTMLEntities(item.correct_answer);
        var incorrect = item.incorrect_answers.map(decodeHTMLEntities);
        var choices = shuffle([correct].concat(incorrect));

        state.questions.push({
          question: decodeHTMLEntities(item.question),
          correct: correct,
          choices: choices
        });
      }

      setLoading(false);
      renderQuestion();

    } catch (e) {
      setLoading(false);
      setApiError(e.message || "Network / API error.");
    }
  }

  // Event listeners
  btnStart.addEventListener("click", runRoundFlow);

  btnReset.addEventListener("click", function () {
    localStorage.removeItem(STORAGE_KEY);
    renderBest();
    alert("Best score reset.");
  });

  btnQuit.addEventListener("click", function () {
    showOnly(screenStart);
  });

  btnPlayAgain.addEventListener("click", runRoundFlow);

  btnHome.addEventListener("click", function () {
    showOnly(screenStart);
  });

  // Boot
  renderBest();
  showOnly(screenStart);
})();
