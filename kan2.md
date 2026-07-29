# Plan kan2: Kanbango Plan Workflow

## Cel

Rozszerzyć Kanbango o niezależny workflow planów, który może być używany przez
OpenCode, inne agenty i CLI. Kanbango pozostaje osobnym repozytorium.

## Zasada architektoniczna

Kanbango nie zna API OpenCode ani hooków pluginu. Udostępnia stabilne operacje
na planie i evidence. Plugin OpenCode jest tylko klientem oraz strażnikiem sesji.

## Funkcjonalność

Dodać bibliotekę domenową oraz odpowiednie operacje CLI/MCP:

- utworzenie taska z zaakceptowanym planem,
- zapis kroków planu jako subtasks,
- oznaczenie bieżącego kroku jako zakończonego,
- zapis evidence: diff, komenda testowa, stdout, stderr i exit code,
- zakończenie workflow i przeniesienie taska do `done`,
- odczyt pełnego statusu planu w stabilnym formacie JSON.

## Domyślne kroki

Każdy zaakceptowany plan dostaje kolejno:

1. `Write tests`
2. `Run tests and confirm red`
3. Kroki implementacyjne dostarczone przez advisora
4. `Run tests and confirm green`

## Test runner

Autodetekcja musi działać per projekt, bez założenia Node:

- Rust: `cargo test` przy `Cargo.toml`,
- Go: `go test ./...` przy `go.mod`,
- Python: `python -m pytest` przy `pyproject.toml` lub `pytest.ini`,
- JavaScript/TypeScript: `npm test`, `pnpm test`, `yarn test` albo `bun test`
  zgodnie z lockfilem i skryptem `test` w `package.json`,
- jawny override przez `OPENCODE_TEST_COMMAND`.

Autodetekcja ma zwracać także powód wyboru komendy i czytelny błąd, gdy nie
znaleziono testów.

## Interfejs

Preferowany jest wspólny moduł JS oraz JSON CLI/MCP, zamiast parsowania tekstu:

- `plan create --json <payload>`,
- `plan advance --json <payload>`,
- `plan evidence --json <payload>`,
- `plan done --json <payload>`,
- odpowiadające operacje w `kanban_manage` lub osobnym narzędziu MCP.

CLI musi zwracać stabilny JSON z `ok`, `task_id`, `subtasks` i `error`.

## Testy TDD

- autodetekcja runnera dla Rust, Go, Python i Node,
- utworzenie planu z czterema grupami kroków,
- aktualizacja kroku bez kasowania pozostałych subtasks,
- zapis evidence bez silent fail,
- zakończenie planu i przejście do `done`,
- błędna komenda testowa i brak testów,
- wywołanie przez CLI i MCP z tym samym rezultatem.

## Kolejność implementacji

1. Model planu i runner detection.
2. Operacje biblioteki Kanbango.
3. CLI i JSON output.
4. MCP adapter.
5. Integracja pluginu OpenCode z tym kontraktem.
6. Test end-to-end w przykładowym projekcie.
