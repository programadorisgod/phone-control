param (
    [string]$Action = "status",
    [int]$Port = 5252
)

$RuleName = "Phone Control Local Only"

function Test-IsAdmin {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

switch ($Action.ToLower()) {
    "allow-lan" {
        if (-not (Test-IsAdmin)) {
            Write-Warning "Se requieren privilegios de Administrador para configurar reglas de Firewall."
            Write-Host "Ejecuta PowerShell como Administrador o usa: Start-Process powershell -Verb RunAs -ArgumentList '-File .\manage-firewall.ps1 allow-lan $Port'"
            exit 1
        }
        Write-Host "[Firewall] Configurando regla en Windows Firewall (solo subred local: LocalSubnet)..."
        Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $RuleName `
                            -Direction Inbound `
                            -LocalPort $Port `
                            -Protocol TCP `
                            -Action Allow `
                            -RemoteAddress LocalSubnet `
                            -Description "Permite conexiones entrantes a Phone Control solo desde la subred local (LAN)." `
                            -ErrorAction Stop | Out-Null
        Write-Host "[OK] Firewall: Puerto $Port permitido unicamente desde la subred local (LocalSubnet)." -ForegroundColor Green
    }

    "allow-any" {
        if (-not (Test-IsAdmin)) {
            Write-Warning "Se requieren privilegios de Administrador para configurar reglas de Firewall."
            exit 1
        }
        Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $RuleName `
                            -Direction Inbound `
                            -LocalPort $Port `
                            -Protocol TCP `
                            -Action Allow `
                            -Description "Permite conexiones entrantes a Phone Control desde cualquier direccion." `
                            -ErrorAction Stop | Out-Null
        Write-Host "[OK] Firewall: Puerto $Port permitido temporalmente para cualquier direccion." -ForegroundColor Yellow
    }

    "remove" {
        if (-not (Test-IsAdmin)) {
            Write-Warning "Se requieren privilegios de Administrador para eliminar reglas de Firewall."
            exit 1
        }
        Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
        Write-Host "[OK] Regla de firewall eliminada. Puerto $Port cerrado." -ForegroundColor Green
    }

    "status" {
        $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
        if ($rule) {
            Write-Host "--- Estado de Windows Firewall para Phone Control ---" -ForegroundColor Cyan
            Write-Host "Regla: $($rule.DisplayName)"
            Write-Host "Habilitada: $($rule.Enabled)"
            Write-Host "Accion: $($rule.Action)"
            Write-Host "Direccion: $($rule.Direction)"
            $portFilter = $rule | Get-NetFirewallPortFilter
            Write-Host "Puerto Local: $($portFilter.LocalPort) ($($portFilter.Protocol))"
            $addressFilter = $rule | Get-NetFirewallAddressFilter
            Write-Host "Direcciones Remotas: $($addressFilter.RemoteAddress)"
        } else {
            Write-Host "No hay reglas activas para Phone Control en el Firewall de Windows." -ForegroundColor Yellow
        }
    }

    default {
        Write-Host "Uso: .\manage-firewall.ps1 [allow-lan|allow-any|remove|status] [puerto]"
    }
}
