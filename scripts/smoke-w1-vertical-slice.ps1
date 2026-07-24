param(
    [string]$BaseUrl = "http://127.0.0.1:3000",
    [string]$DemoToken = ""
)

$ErrorActionPreference = "Stop"
$ContractVersion = "1.0"
$ClientVersion = "0.1.0-smoke"

function New-HushHeaders {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestId,
        [string]$IdempotencyKey = ""
    )

    $headers = @{
        "X-Request-ID"       = $RequestId
        "X-Client-Version"   = $ClientVersion
        "X-Contract-Version" = $ContractVersion
    }
    if ($DemoToken) {
        $headers["X-Hush-Demo-Token"] = $DemoToken
    }
    if ($IdempotencyKey) {
        $headers["Idempotency-Key"] = $IdempotencyKey
    }
    return $headers
}

function Invoke-HushPost {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$RequestId,
        [Parameter(Mandatory = $true)]
        [hashtable]$Body,
        [string]$IdempotencyKey = ""
    )

    $response = Invoke-HushRequest `
        -Method Post `
        -Path $Path `
        -RequestId $RequestId `
        -Body $Body `
        -IdempotencyKey $IdempotencyKey
    return $response.Body
}

function Invoke-HushRequest {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("Get", "Post")]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$RequestId,
        [hashtable]$Body,
        [string]$IdempotencyKey = ""
    )

    $endpoint = "$BaseUrl$Path"
    Write-Host "  -> $Method $Path request_id=$RequestId"

    $arguments = @{
        Method          = $Method
        Uri             = $endpoint
        Headers         = New-HushHeaders `
            -RequestId $RequestId `
            -IdempotencyKey $IdempotencyKey
        UseBasicParsing = $true
    }
    if ($null -ne $Body) {
        $arguments["ContentType"] = "application/json"
        $arguments["Body"] = $Body | ConvertTo-Json -Depth 12 -Compress
    }

    try {
        $response = Invoke-WebRequest @arguments
        $parsedBody = if ([string]::IsNullOrWhiteSpace($response.Content)) {
            $null
        } else {
            $response.Content | ConvertFrom-Json
        }
        $origin = $response.Headers["X-Hush-Data-Origin"]
        if ([string]::IsNullOrWhiteSpace($origin)) {
            $origin = "n/a"
        }
        Write-Host "  <- HTTP $($response.StatusCode) request_id=$RequestId origin=$origin"
        return [PSCustomObject]@{
            StatusCode = [int]$response.StatusCode
            Headers    = $response.Headers
            Body       = $parsedBody
        }
    } catch {
        $status = "network_or_unknown"
        if ($null -ne $_.Exception.Response) {
            try {
                $status = [int]$_.Exception.Response.StatusCode
            } catch {
                $status = $_.Exception.Response.StatusCode
            }
        }
        $responseText = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($responseText)) {
            $responseText = $_.Exception.Message
        }
        throw @"
Hush smoke request failed.
Endpoint: $Method $endpoint
Request ID: $RequestId
Status: $status
Response: $responseText
"@
    }
}

Write-Host "1/5 health"
$healthResponse = Invoke-HushRequest `
    -Method Get `
    -Path "/v1/health" `
    -RequestId "req_smoke_health"
$health = $healthResponse.Body
if ($health.status -ne "ok" -or $health.contract_version -ne "1.0") {
    throw "Health response did not match Contract v1."
}

Write-Host "2/5 first check-in"
$firstRequestId = "req_smoke_checkin_first"
$first = Invoke-HushPost `
    -Path "/v1/rest/check-in" `
    -RequestId $firstRequestId `
    -Body @{
        schema_version   = "1.0"
        request_id       = $firstRequestId
        session_id       = "session_smoke"
        source           = "manual_ios"
        description      = "I cannot tell what kind of tired this is"
        input_mode       = "text"
        available_minutes = 3
        willing_to_move  = $null
        current_place    = "desk"
        follow_up_answer = $null
    }

Write-Host "3/5 answered check-in and fixed Quest recommendation"
$secondRequestId = "req_smoke_checkin_second"
$second = Invoke-HushPost `
    -Path "/v1/rest/check-in" `
    -RequestId $secondRequestId `
    -Body @{
        schema_version   = "1.0"
        request_id       = $secondRequestId
        session_id       = "session_smoke"
        source           = "manual_ios"
        description      = "I cannot tell what kind of tired this is"
        input_mode       = "text"
        available_minutes = 3
        willing_to_move  = $null
        current_place    = "desk"
        follow_up_answer = "My brain cannot think"
    }
if ($second.needs_follow_up) {
    throw "The answered check-in requested an invalid second follow-up."
}

$recommendRequestId = "req_smoke_recommend"
$recommend = Invoke-HushPost `
    -Path "/v1/rest/recommend" `
    -RequestId $recommendRequestId `
    -Body @{
        schema_version     = "1.0"
        request_id         = $recommendRequestId
        session_id         = "session_smoke"
        content_version    = "1.0.0"
        fatigue_type       = $second.fatigue_type
        user_preference    = "quiet"
        available_minutes  = 3
        source             = "ios_app"
        location_tags      = @("any")
        excluded_quest_ids = @()
        allowed_quest_ids  = @("look_far_01")
    }
if ($recommend.quest_id -ne "look_far_01") {
    throw "Recommend returned an unexpected Quest ID."
}

Write-Host "4/5 Handoff start"
$handoffRequestId = "req_smoke_handoff"
$job = Invoke-HushPost `
    -Path "/v1/handoff/start" `
    -RequestId $handoffRequestId `
    -IdempotencyKey "idem-smoke-handoff" `
    -Body @{
        schema_version  = "1.0"
        request_id      = $handoffRequestId
        source          = "ios_app"
        include_gmail   = $false
        gmail_account_id = $null
        open_loops      = @(
            @{
                id           = "ol_smoke_1"
                text         = "Confirm the submission format tomorrow"
                desired_time = "tomorrow_morning"
            },
            @{
                id           = "ol_smoke_2"
                text         = "Check the dark mode button tomorrow"
                desired_time = "tomorrow"
            }
        )
        response_channel = "app"
        timezone         = "Asia/Shanghai"
        locale           = "zh-CN"
    }

Write-Host "5/5 Handoff poll"
$terminal = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    $pollRequestId = "req_smoke_poll_$attempt"
    $pollResponse = Invoke-HushRequest `
        -Method Get `
        -Path "/v1/handoff/$($job.job_id)" `
        -RequestId $pollRequestId
    $state = $pollResponse.Body

    Write-Host "  $($state.status) / $($state.progress_stage)"
    if ($state.status -in @("succeeded", "failed", "cancelled")) {
        $terminal = $state
        break
    }
    Start-Sleep -Seconds 2
}

if ($null -eq $terminal) {
    throw "Handoff did not reach a terminal state within 60 seconds."
}
if ($terminal.status -ne "succeeded") {
    throw "Handoff ended with status: $($terminal.status)"
}
if (
    $terminal.summary.pause_receipt.coverage.excluded_sources `
        -notcontains "authorized_gmail_not_requested"
) {
    throw "Open Loops Only coverage was not reported."
}

Write-Host "Smoke passed: health, check-in, recommend, handoff start, poll."
